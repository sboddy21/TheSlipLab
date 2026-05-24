import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const INPUTS = {
  decisionCenter: path.join(ROOT, "website/data/hr_decision_center.json"),
  stacks: path.join(ROOT, "website/data/mlb_team_stacks.json"),
  weather: path.join(ROOT, "website/data/mlb_weather.json")
};

const OUT_JSON = path.join(ROOT, "website/data/content/x_daily_queue.json");
const OUT_TXT = path.join(ROOT, "exports/content/x_daily_queue.txt");

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function easternIsoForToday(hour, minute) {
  return `${todayKey()}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function num(value) {
  const n = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : 0;
}

function rows(value, type) {
  if (Array.isArray(value)) return value;
  if (type === "decision") return value?.sections?.bestPicks || value?.allPlayers || [];
  if (type === "stacks") return value?.stacks || [];
  if (type === "weather") return value?.weather || [];
  return [];
}

function name(row) {
  return clean(row.player || row.name || row.batter || row.hitter || "Unknown");
}

function pitcher(row) {
  return clean(row.pitcher || row.opposingPitcher || row.probable_pitcher || "");
}

function score(row) {
  return num(row.hrConfidence || row.hrScore || row.score || row.powerScore || row.finalScore);
}

function pitcherRisk(row) {
  return num(row.pitcherRisk || row.pitcherAttackScore || row.pitcher_vulnerability || row.attackScore);
}

function linePlayer(row, index) {
  const p = pitcher(row);
  return `${index + 1}. ${name(row)}${p ? ` vs ${p}` : ""}`;
}

function postText(title, lines, note = "") {
  const body = [title, "", ...lines];
  if (note) body.push("", note);
  return body.join("\n").slice(0, 265).trim();
}

function buildPost(type, minuteOffset, text) {
  return {
    id: `${todayKey()}_${type}`,
    date: todayKey(),
    type,
    status: "queued",
    scheduled_for_eastern: easternIsoForToday(9, 30 + minuteOffset),
    text,
    posted: false,
    posted_at: null,
    x_post_id: null
  };
}

function carryPostedState(newPosts, previousPosts) {
  const old = new Map(previousPosts.map(post => [post.id, post]));

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

function main() {
  ensureDir(OUT_JSON);
  ensureDir(OUT_TXT);

  const previousQueue = readJson(OUT_JSON, { posts: [] });

  const decision = rows(readJson(INPUTS.decisionCenter, {}), "decision");
  const stacks = rows(readJson(INPUTS.stacks, {}), "stacks");
  const weather = rows(readJson(INPUTS.weather, {}), "weather");

  const topPlayers = [...decision]
    .filter(row => name(row) !== "Unknown")
    .sort((a, b) => score(b) - score(a));

  const meatballs = [...decision]
    .filter(row => name(row) !== "Unknown")
    .sort((a, b) => pitcherRisk(b) - pitcherRisk(a) || score(b) - score(a));

  const queue = [];

  if (topPlayers.length) {
    queue.push(buildPost(
      "TOP_HR_TARGETS",
      0,
      postText(
        "THE SLIP LAB TOP HR TARGETS 🚀",
        topPlayers.slice(0, 4).map(linePlayer),
        "Early board. Lineups matter."
      )
    ));
  }

  if (topPlayers.length) {
    queue.push(buildPost(
      "VALUE_HR_WATCH",
      1,
      postText(
        "THE SLIP LAB VALUE HR WATCH 👀",
        topPlayers.slice(1, 5).map(linePlayer),
        "Numbers worth checking before lock."
      )
    ));
  }

  if (meatballs.length) {
    queue.push(buildPost(
      "MEATBALL_MATCHUPS",
      2,
      postText(
        "THE SLIP LAB MEATBALL MATCHUPS 🍝",
        meatballs.slice(0, 4).map(linePlayer),
        "Pitcher attack spots only."
      )
    ));
  }

  if (stacks.length) {
    queue.push(buildPost(
      "TEAM_STACK_WATCH",
      3,
      postText(
        "THE SLIP LAB TEAM STACK WATCH 🧪",
        stacks.slice(0, 4).map((row, index) => {
          const team = clean(row.team || "Unknown");
          const grade = clean(row.grade || row.stackScore || "");
          const opp = clean(row.opponent || "");
          return `${index + 1}. ${team}${grade ? ` ${grade}` : ""}${opp ? ` vs ${opp}` : ""}`;
        }),
        "Best offenses on the board."
      )
    ));
  }

  if (weather.length) {
    queue.push(buildPost(
      "WEATHER_BOOSTS",
      4,
      postText(
        "THE SLIP LAB WEATHER BOOSTS 🌬️",
        weather
          .sort((a, b) => num(b.windSpeed) - num(a.windSpeed))
          .slice(0, 4)
          .map((row, index) => {
            const venue = clean(row.venue || "");
            const city = clean(row.city || "");
            const wind = clean(row.windCompass || "");
            return `${index + 1}. ${venue || city} ${num(row.windSpeed)} MPH ${wind}`;
          }),
        "Weather can move the HR board."
      )
    ));
  }

  if (meatballs.length) {
    queue.push(buildPost(
      "PITCHER_VULNERABILITIES",
      5,
      postText(
        "TOP PITCHER VULNERABILITIES",
        meatballs.slice(0, 3).map((row, index) => {
          const p = pitcher(row) || clean(row.opposingPitcher || "Unknown");
          const bats = name(row);
          return `${index + 1}. ${p} attack bat: ${bats}`;
        }),
        "Use this with the HR board."
      )
    ));
  }

  const finalPosts = carryPostedState(queue, previousQueue.posts || []);

  fs.writeFileSync(OUT_JSON, JSON.stringify({
    date: todayKey(),
    window: "9:30 AM to 9:35 AM Eastern",
    cadence: "one post per minute",
    textOnly: true,
    count: finalPosts.length,
    posts: finalPosts
  }, null, 2));

  fs.writeFileSync(
    OUT_TXT,
    finalPosts.map(post => [
      "========================================",
      post.id,
      post.scheduled_for_eastern,
      post.type,
      "",
      post.text
    ].join("\n")).join("\n\n")
  );

  console.log("THE SLIP LAB X DAILY QUEUE COMPLETE");
  console.log(`Posts queued: ${finalPosts.length}`);
  console.log("Schedule: 9:30, 9:31, 9:32, 9:33, 9:34, 9:35");
  console.log(`Saved: ${OUT_JSON}`);
}

main();
