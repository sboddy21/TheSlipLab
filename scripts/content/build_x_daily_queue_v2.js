import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const OUT_DIR = path.join(ROOT, "exports", "content");
const SITE_DIR = path.join(ROOT, "website", "data", "content");

const TXT_OUT = path.join(OUT_DIR, "x_daily_queue.txt");
const JSON_OUT = path.join(OUT_DIR, "x_daily_queue.json");
const SITE_JSON_OUT = path.join(SITE_DIR, "x_daily_queue.json");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SITE_DIR, { recursive: true });

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function easternPostTime(minutesAfter930 = 0) {
  const baseMinute = 30 + minutesAfter930;
  const hour = 9 + Math.floor(baseMinute / 60);
  const minute = baseMinute % 60;
  return `${todayKey()}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`;
}

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function num(v) {
  const n = Number(String(v ?? "").replace("%", "").replace("+", ""));
  return Number.isFinite(n) ? n : 0;
}

function oneDecimal(v) {
  return num(v).toFixed(1);
}

function playerName(row) {
  return clean(row.player || row.name || row.batter || row.hitter || "Unknown");
}

function pitcherName(row) {
  return clean(row.pitcher || row.opposingPitcher || row.probablePitcher || "");
}

function opponentName(row) {
  return clean(row.opponent || row.opp || "");
}

function teamName(row) {
  return clean(row.team || row.playerTeam || row.batterTeam || "");
}

function uniqueRows(rows, limit = 8) {
  const used = new Set();
  const out = [];

  for (const row of rows || []) {
    const player = playerName(row);
    const key = player.toLowerCase();
    if (!player || player === "Unknown" || used.has(key)) continue;
    used.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }

  return out;
}

function postObject(type, minutesAfter930, text, players = []) {
  return {
    id: `${todayKey()}_${type}`,
    date: todayKey(),
    type,
    status: "queued",
    scheduled_for_eastern: easternPostTime(minutesAfter930),
    text: text.slice(0, 275).trim(),
    players,
    posted: false,
    posted_at: null,
    x_post_id: null,
    created_at: new Date().toISOString()
  };
}

function makeSectionPost({ type, minute, title, rows, lineBuilder, footer = "" }) {
  const list = uniqueRows(rows, 8);
  if (!list.length) return null;

  const lines = list.map((row, index) => lineBuilder(row, index)).filter(Boolean);

  if (!lines.length) return null;

  const text = [
    title,
    "",
    ...lines,
    footer ? "" : null,
    footer || null
  ].filter(Boolean).join("\n");

  return postObject(type, minute, text, list.map(playerName));
}

function topTargetsLine(row, index) {
  const p = pitcherName(row);
  return `${index + 1}. ${playerName(row)} ${oneDecimal(row.hrConfidence)} HR Conf${p ? ` vs ${p}` : ""}`;
}

function valueLine(row, index) {
  const p = pitcherName(row);
  const value = row.valueScore !== undefined ? ` | Value ${oneDecimal(row.valueScore)}` : "";
  return `${index + 1}. ${playerName(row)}${value}${p ? ` vs ${p}` : ""}`;
}

function lottoLine(row, index) {
  const p = pitcherName(row);
  const score = row.lottoScore !== undefined ? ` | Lotto ${oneDecimal(row.lottoScore)}` : "";
  return `${index + 1}. ${playerName(row)}${score}${p ? ` vs ${p}` : ""}`;
}

function pitchTypeLine(row, index) {
  const pitch = clean(row.bestPitch || row.pitchTypeDestructionPitch || row.pitchType || "");
  const score = row.pitchTypeDestructionScore || row.pitchTypeScore || row.pitchEdge;
  return `${index + 1}. ${playerName(row)} ${pitch ? `vs ${pitch}` : ""} | Edge ${oneDecimal(score)}`;
}

function weatherLine(row, index) {
  const matchup = `${teamName(row)}${opponentName(row) ? ` vs ${opponentName(row)}` : ""}`;
  const score = row.pullWindHrScore || row.weatherScore || row.weather;
  return `${index + 1}. ${playerName(row)} | Weather ${oneDecimal(score)}${matchup.trim() ? ` | ${matchup}` : ""}`;
}

function bullpenLine(row, index) {
  const score = row.bullpenInheritanceScore || row.bullpenScore || row.bullpen;
  return `${index + 1}. ${playerName(row)} | Bullpen ${oneDecimal(score)}${opponentName(row) ? ` vs ${opponentName(row)}` : ""}`;
}

function safeLine(row, index) {
  return `${index + 1}. ${playerName(row)} ${oneDecimal(row.hrConfidence)} HR Conf | Power ${oneDecimal(row.powerScore)}`;
}

function pickOnePost(ifOnlyOne, minute) {
  const picks = ifOnlyOne?.picks || {};
  const rows = [
    ["Best Overall", picks.bestOverall],
    ["Safest Play", picks.safestPlay],
    ["Highest Ceiling", picks.highestCeiling],
    ["Best Weather", picks.bestWeatherPlay],
    ["Best Pitch Matchup", picks.bestPitchMatchup],
    ["Best Longshot", picks.bestLongshot]
  ].filter(([, row]) => row && playerName(row) !== "Unknown");

  if (!rows.length) return null;

  const lines = rows.map(([label, row]) => {
    const score = row.pickOneScore !== undefined ? ` | ${oneDecimal(row.pickOneScore)}` : "";
    return `${label}: ${playerName(row)}${score}`;
  });

  const text = [
    "🚀 IF I CAN ONLY PICK ONE",
    "",
    ...lines,
    "",
    "One board. Six angles. No guessing."
  ].join("\n");

  return postObject("IF_ONLY_ONE", minute, text, rows.map(([, row]) => playerName(row)));
}

function resultsPost(results, minute) {
  const rows = Array.isArray(results?.homeRuns) ? results.homeRuns : [];
  if (!rows.length) return null;

  const byPlayer = new Map();

  for (const row of rows) {
    const player = playerName(row);
    if (!player || player === "Unknown") continue;

    const current = byPlayer.get(player) || {
      player,
      team: teamName(row),
      hrs: 0,
      maxDistance: 0,
      maxEv: 0
    };

    current.hrs += num(row.hr || 1);
    current.maxDistance = Math.max(current.maxDistance, num(row.distance));
    current.maxEv = Math.max(current.maxEv, num(row.exitVelocity));

    byPlayer.set(player, current);
  }

  const leaders = [...byPlayer.values()]
    .sort((a, b) => b.hrs - a.hrs || b.maxEv - a.maxEv || b.maxDistance - a.maxDistance)
    .slice(0, 8);

  if (!leaders.length) return null;

  const lines = leaders.map((row, index) => {
    const extras = [
      row.hrs ? `${row.hrs} HR` : "",
      row.maxDistance ? `${Math.round(row.maxDistance)} ft` : "",
      row.maxEv ? `${oneDecimal(row.maxEv)} EV` : ""
    ].filter(Boolean).join(" | ");

    return `${index + 1}. ${row.player} ${extras}`;
  });

  const text = [
    "⚾ HR RESULTS CHECK",
    "",
    `${rows.length} home runs tracked today.`,
    "",
    ...lines
  ].join("\n");

  return postObject("HR_RESULTS_CHECK", minute, text, leaders.map(r => r.player));
}

function weatherBoardPost(weather, minute) {
  const rows = Array.isArray(weather?.weather)
    ? weather.weather
    : Array.isArray(weather?.games)
      ? weather.games
      : Array.isArray(weather)
        ? weather
        : [];

  const usable = rows
    .map(row => ({
      venue: clean(row.venue || row.ballpark || row.stadium || row.city),
      matchup: clean(row.matchup || row.game || ""),
      temp: num(row.temp || row.temperature),
      wind: num(row.windSpeed || row.wind_speed),
      compass: clean(row.windCompass || row.windDirection || row.wind || ""),
      carry: num(row.carryScore || row.hrWeatherBoost || row.weatherScore || row.windHrScore)
    }))
    .filter(row => row.venue || row.matchup)
    .sort((a, b) => b.carry - a.carry || b.wind - a.wind)
    .slice(0, 6);

  if (!usable.length) return null;

  const lines = usable.map((row, index) => {
    const place = row.matchup || row.venue;
    const parts = [
      row.carry ? `+${oneDecimal(row.carry)} carry` : "",
      row.temp ? `${Math.round(row.temp)}°` : "",
      row.wind ? `${Math.round(row.wind)} mph ${row.compass}` : ""
    ].filter(Boolean).join(" | ");

    return `${index + 1}. ${place}${parts ? ` | ${parts}` : ""}`;
  });

  const text = [
    "🌤️ HR WEATHER WATCH",
    "",
    "Best carry spots today:",
    "",
    ...lines,
    "",
    "Weather does not create power. It amplifies it."
  ].join("\n");

  return postObject("HR_WEATHER_WATCH", minute, text, []);
}

function carryPostedState(newPosts, oldQueue) {
  const oldPosts = Array.isArray(oldQueue)
    ? oldQueue
    : Array.isArray(oldQueue?.posts)
      ? oldQueue.posts
      : [];

  const old = new Map(oldPosts.map(post => [post.id, post]));

  return newPosts.map(post => {
    const previous = old.get(post.id);
    if (!previous) return post;

    return {
      ...post,
      status: previous.status || post.status,
      posted: Boolean(previous.posted),
      posted_at: previous.posted_at || null,
      x_post_id: previous.x_post_id || null
    };
  });
}

const decision = readJson(path.join(ROOT, "website", "data", "hr_decision_center.json"), {});
const results = readJson(path.join(ROOT, "website", "data", "mlb_results.json"), {});
const weather = readJson(path.join(ROOT, "website", "data", "mlb_weather.json"), {});
const previousQueue = readJson(SITE_JSON_OUT, { posts: [] });

const sections = decision.sections || {};

const posts = [
  makeSectionPost({
    type: "TOP_HR_TARGETS",
    minute: 0,
    title: "🚨 TOP HR TARGETS TODAY",
    rows: sections.bestPicks || [],
    lineBuilder: topTargetsLine,
    footer: "Lineups still matter. Final board updates all day."
  }),
  makeSectionPost({
    type: "SAFEST_HR_LOOKS",
    minute: 1,
    title: "🔒 SAFEST HR LOOKS",
    rows: sections.safestPlays || [],
    lineBuilder: safeLine,
    footer: "Highest stability profiles on the board."
  }),
  makeSectionPost({
    type: "BEST_VALUE_HR_LOOKS",
    minute: 2,
    title: "💎 BEST VALUE HR LOOKS",
    rows: sections.bestValue || [],
    lineBuilder: valueLine,
    footer: "Value means model signal plus matchup context."
  }),
  makeSectionPost({
    type: "LOTTO_BOMBS",
    minute: 3,
    title: "💣 LOTTO BOMBS",
    rows: sections.lottoBombs || [],
    lineBuilder: lottoLine,
    footer: "Volatile bats. Real ceiling. Not safe."
  }),
  makeSectionPost({
    type: "PITCH_TYPE_EDGES",
    minute: 4,
    title: "🎯 TOP PITCH TYPE EDGES",
    rows: sections.pitchTypeEdges || [],
    lineBuilder: pitchTypeLine,
    footer: "Hitter damage profile matched to pitcher attack."
  }),
  makeSectionPost({
    type: "WEATHER_CARRY_PLAYERS",
    minute: 5,
    title: "🌬️ WEATHER CARRY PLAYERS",
    rows: sections.weatherCarry || [],
    lineBuilder: weatherLine,
    footer: "Power first. Weather second."
  }),
  makeSectionPost({
    type: "BULLPEN_BOOSTS",
    minute: 6,
    title: "🔥 BULLPEN BOOSTS",
    rows: sections.bullpenBoosts || [],
    lineBuilder: bullpenLine,
    footer: "Late game HR context matters."
  }),
  pickOnePost(sections.ifOnlyOne, 7),
  weatherBoardPost(weather, 8),
  resultsPost(results, 9)
].filter(Boolean);

const finalPosts = carryPostedState(posts, previousQueue);

const queuePayload = {
  date: todayKey(),
  window: "9:30 AM Eastern",
  cadence: "one post per minute",
  source: "real Decision Center sections only",
  fakeData: false,
  count: finalPosts.length,
  posts: finalPosts
};

fs.writeFileSync(JSON_OUT, JSON.stringify(queuePayload, null, 2));
fs.writeFileSync(SITE_JSON_OUT, JSON.stringify(queuePayload, null, 2));

fs.writeFileSync(
  TXT_OUT,
  finalPosts.map(post => [
    "========================================",
    post.id,
    post.scheduled_for_eastern,
    post.type,
    "",
    post.text
  ].join("\n")).join("\n\n")
);

console.log("THE SLIP LAB X DAILY QUEUE V2 COMPLETE");
console.log("Date:", queuePayload.date);
console.log("Posts:", finalPosts.length);
console.log("Source:", queuePayload.source);
console.log("Saved:", JSON_OUT);
console.log("Saved:", SITE_JSON_OUT);
console.log("Saved:", TXT_OUT);
