import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const SITE_CONTENT = path.join(DATA, "content");
const EXPORT_CONTENT = path.join(ROOT, "exports", "content");
const SITE_OUT = path.join(SITE_CONTENT, "x_daily_queue.json");
const JSON_OUT = path.join(EXPORT_CONTENT, "x_daily_queue.json");
const TXT_OUT = path.join(EXPORT_CONTENT, "x_daily_queue.txt");
const HISTORY_FILE = path.join(SITE_CONTENT, "x_post_history.json");
const MAX_INPUT_AGE_MS = 15 * 60 * 1000;

fs.mkdirSync(SITE_CONTENT, { recursive: true });
fs.mkdirSync(EXPORT_CONTENT, { recursive: true });

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function easternParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

function currentSlot({ hour }) {
  if (hour === 1) return "overnight";
  if (hour < 4) return "closed";
  if (hour >= 20) return "evening";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  return "pregame";
}

function requireFresh(label, data, timestampField, dateField = null, expectedDate = easternParts().date) {
  if (!data || typeof data !== "object") throw new Error(`X queue freshness validation failed: ${label} is missing`);
  const timestamp = data[timestampField];
  const parsed = Date.parse(timestamp);
  const age = Date.now() - parsed;
  if (!timestamp || !Number.isFinite(parsed) || age < 0 || age > MAX_INPUT_AGE_MS) {
    throw new Error(`X queue freshness validation failed: ${label} is outside the 15-minute production window`);
  }
  if (dateField && data[dateField] !== expectedDate) {
    throw new Error(`X queue freshness validation failed: ${label} ${dateField} is ${data[dateField] || "missing"}; expected ${expectedDate}`);
  }
  return { file: label, timestampField, timestamp, ageSeconds: Math.floor(age / 1000) };
}

function requireFinalizedResults(label, data, expectedDate) {
  const result = requireFresh(label, data, "updatedAt", "date", expectedDate);
  const scheduled = Number(data?.totalScheduledGames || 0);
  const finalGames = Number(data?.finalGames || 0);
  const liveGames = Number(data?.liveGames || 0);
  const skippedGames = Number(data?.skippedGames || 0);

  if (!scheduled || finalGames !== scheduled || liveGames !== 0 || skippedGames !== 0) {
    throw new Error(`X queue overnight validation failed: ${label} is not a fully finalized slate`);
  }

  return { ...result, scheduledGames: scheduled, finalGames };
}

function requirePregameHistory(label, data) {
  const timestamp = data?.updatedAt;
  const parsed = Date.parse(timestamp);
  const players = data?.history && typeof data.history === "object"
    ? Object.keys(data.history).length
    : 0;

  if (!timestamp || !Number.isFinite(parsed) || parsed > Date.now() || !players) {
    throw new Error(`X queue overnight validation failed: ${label} is missing a valid pregame archive`);
  }

  return { file: label, timestampField: "updatedAt", timestamp, players, mode: "historical pregame archive" };
}

const content = readJson(path.join(SITE_CONTENT, "x_posts.json"));
const decision = readJson(path.join(DATA, "hr_decision_center.json"));
const weather = readJson(path.join(DATA, "mlb_weather.json"));
const results = readJson(path.join(DATA, "mlb_results.json"));
const previousResults = readJson(path.join(DATA, "mlb_results_previous.json"));
const aiHistory = readJson(path.join(DATA, "hr_ai_history.json"));
const health = readJson(path.join(DATA, "health_status.json"));
const history = readJson(HISTORY_FILE, { posts: [] });
const now = easternParts();
const allowedSlotOverrides = new Set(["morning", "midday", "afternoon", "pregame", "evening", "overnight", "closed"]);
const requestedSlot = String(process.env.X_SLOT_OVERRIDE || "").trim().toLowerCase();
if (requestedSlot && !allowedSlotOverrides.has(requestedSlot)) {
  throw new Error(`X queue validation failed: unknown slot override ${requestedSlot}`);
}
const slot = allowedSlotOverrides.has(requestedSlot) ? requestedSlot : currentSlot(now);

if (!["overnight", "closed"].includes(slot) && (health?.status !== "healthy" || health?.source !== "mlb_fast_refresh")) {
  throw new Error("X queue freshness validation failed: health_status.json is not a healthy mlb_fast_refresh output");
}

const yesterday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(Date.now() - 24 * 60 * 60 * 1000));

const validatedInputs = slot === "closed"
  ? [requireFresh("content/x_posts.json", content, "updatedAt", "date")]
  : slot === "overnight"
    ? [
      requireFresh("content/x_posts.json", content, "updatedAt", "date"),
      requireFinalizedResults("mlb_results_previous.json", previousResults, yesterday),
      requirePregameHistory("hr_ai_history.json", aiHistory)
    ]
    : [
      requireFresh("content/x_posts.json", content, "updatedAt", "date"),
      requireFresh("hr_decision_center.json", decision, "updatedAt", "pitcherDate"),
      requireFresh("mlb_weather.json", weather, "updatedAt", "date"),
      requireFresh("mlb_results.json", results, "updatedAt", "date"),
      requireFresh("health_status.json", health, "generatedAt")
    ];

const alreadyPosted = new Set((Array.isArray(history?.posts) ? history.posts : [])
  .filter(post => post.status === "posted" && post.x_post_id)
  .map(post => post.id));
const slotAlreadyPosted = (Array.isArray(history?.posts) ? history.posts : [])
  .some(post => post.date === now.date && post.slot === slot && post.status === "posted" && post.x_post_id);

const due = slotAlreadyPosted ? [] : (Array.isArray(content.posts) ? content.posts : [])
  .filter(post => post.date === now.date && post.slot === slot && !alreadyPosted.has(post.id))
  .filter(post => slot !== "overnight" || post.verifiedPregame === true)
  .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
  .slice(0, 1)
  .map(post => ({
    id: post.id,
    date: post.date,
    type: post.type,
    slot: post.slot,
    status: "queued",
    scheduled_for_eastern: new Date().toISOString(),
    text: post.text,
    players: post.players || [],
    posted: false,
    posted_at: null,
    x_post_id: null,
    created_at: post.createdAt || content.updatedAt
  }));

const payload = {
  updatedAt: new Date().toISOString(),
  date: now.date,
  slot,
  cadence: "one current story per workflow run",
  source: "Content Engine 3.0 selected from current production MLB data",
  fakeData: false,
  inputValidation: { status: "passed", checkedAt: new Date().toISOString(), maxAgeMinutes: 15, inputs: validatedInputs },
  count: due.length,
  posts: due
};

for (const file of [SITE_OUT, JSON_OUT]) fs.writeFileSync(file, JSON.stringify(payload, null, 2));
fs.writeFileSync(TXT_OUT, due.length ? due.map(post => `${post.slot.toUpperCase()} | ${post.type}\n${post.text}`).join("\n\n") : `No new ${slot} post due for ${now.date}.`);

console.log("THE SLIP LAB X DAILY QUEUE V3 COMPLETE");
console.log("Date:", payload.date);
console.log("Slot:", slot);
console.log("Posts queued:", due.length);
console.log("Saved:", SITE_OUT);
