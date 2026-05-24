import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const INPUTS = {
  decisionCenter: path.join(ROOT, "website/data/hr_decision_center.json"),
  stacks: path.join(ROOT, "website/data/mlb_team_stacks.json"),
  weather: path.join(ROOT, "website/data/mlb_weather.json"),
  xPosts: path.join(ROOT, "website/data/content/x_posts.json")
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
  const date = todayKey();
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value, type = "") {
  if (Array.isArray(value)) return value;

  if (type === "decisionCenter") {
    return value?.sections?.bestPicks || value?.allPlayers || [];
  }

  if (type === "stacks") {
    return value?.stacks || [];
  }

  if (type === "weather") {
    return value?.weather || [];
  }

  if (type === "xPosts") {
    return value?.posts || [];
  }

  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.plays)) return value.plays;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;

  return [];
}

function num(value) {
  const n = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : 0;
}

function pickName(row) {
  return cleanText(
    row.player ||
    row.name ||
    row.batter ||
    row.hitter ||
    row.player_name ||
    "Unknown"
  );
}

function pickTeam(row) {
  return cleanText(
    row.team ||
    row.playerTeam ||
    row.batter_team ||
    row.player_team ||
    ""
  );
}

function pickOpponent(row) {
  return cleanText(
    row.opponent ||
    row.opp ||
    row.pitcherTeam ||
    row.opposing_team ||
    ""
  );
}

function pickPitcher(row) {
  return cleanText(
    row.pitcher ||
    row.opposingPitcher ||
    row.opposing_pitcher ||
    row.probable_pitcher ||
    ""
  );
}

function pickOdds(row) {
  return cleanText(
    row.odds ||
    row.best_odds ||
    row.hr_odds ||
    row.price ||
    row.line ||
    ""
  );
}

function pickScore(row) {
  return num(
    row.hrConfidence ||
    row.hrScore ||
    row.score ||
    row.finalScore ||
    row.modelScore ||
    row.total_score ||
    row.overall_score ||
    row.powerScore
  );
}

function sortByScore(rows) {
  return [...rows].sort((a, b) => pickScore(b) - pickScore(a));
}

function formatPlayerLine(row, index) {
  const name = pickName(row);
  const odds = pickOdds(row);
  const pitcher = pickPitcher(row);
  const score = pickScore(row);

  const parts = [`${index + 1}. ${name}`];

  if (odds) parts.push(odds);
  if (score) parts.push(`${score.toFixed(1)} score`);
  if (pitcher) parts.push(`vs ${pitcher}`);

  return parts.join(" | ");
}

function trimPost(text) {
  if (text.length <= 275) return text;
  return text.slice(0, 272).trimEnd() + "...";
}

function makeGraphicName(type) {
  return `exports/x/${todayKey()}_${type.toLowerCase()}.png`;
}

function buildPost({
  type,
  title,
  bodyLines,
  minuteOffset,
  cta
}) {
  const scheduledMinute = 30 + minuteOffset;

  const text = trimPost([
    title,
    "",
    ...bodyLines,
    "",
    cta || "Use the data. Pick your spots. 🧪"
  ].join("\n"));

  return {
    id: `${todayKey()}_${type}`,
    date: todayKey(),
    type,
    status: "queued",
    scheduled_for_eastern: easternIsoForToday(9, scheduledMinute),
    text,
    graphic: makeGraphicName(type),
    posted: false,
    posted_at: null,
    x_post_id: null
  };
}

function getTopPlayers(decisionRows) {
  return sortByScore(decisionRows)
    .filter(row => pickName(row) !== "Unknown")
    .slice(0, 5);
}

function getValuePlayers(decisionRows) {
  return [...decisionRows]
    .filter(row => pickName(row) !== "Unknown")
    .sort((a, b) => {
      const edgeA = num(
        a.edge ||
        a.ev ||
        a.valueScore ||
        a.value_score ||
        a.model_edge
      );

      const edgeB = num(
        b.edge ||
        b.ev ||
        b.valueScore ||
        b.value_score ||
        b.model_edge
      );

      return edgeB - edgeA || pickScore(b) - pickScore(a);
    })
    .slice(0, 5);
}

function getMeatballPlayers(decisionRows) {
  return [...decisionRows]
    .filter(row => pickName(row) !== "Unknown")
    .sort((a, b) => {
      const aScore = num(
        a.pitcherRisk ||
        a.pitcherAttackScore ||
        a.pitcher_attack_score ||
        a.attackScore ||
        a.pitcher_vulnerability
      );

      const bScore = num(
        b.pitcherRisk ||
        b.pitcherAttackScore ||
        b.pitcher_attack_score ||
        b.attackScore ||
        b.pitcher_vulnerability
      );

      return bScore - aScore || pickScore(b) - pickScore(a);
    })
    .slice(0, 5);
}

function getStackLines(stackRows) {
  return stackRows
    .slice(0, 5)
    .map((row, index) => {
      const team = cleanText(row.team || "Unknown");
      const score = cleanText(row.grade || row.stackScore || "");
      const opponent = cleanText(row.opponent || "");
      return `${index + 1}. ${team}${score ? ` | ${score}` : ""}${opponent ? ` | vs ${opponent}` : ""}`;
    });
}

function getWeatherLines(weatherRows) {
  return weatherRows
    .sort((a, b) => num(b.windSpeed) - num(a.windSpeed))
    .slice(0, 5)
    .map((row, index) => {
      const venue = cleanText(row.venue || "");
      const city = cleanText(row.city || "");
      const wind = cleanText(row.windCompass || "");
      const speed = num(row.windSpeed);
      const temp = num(row.temp);

      return `${index + 1}. ${venue} | ${city} | ${speed} MPH ${wind} | ${temp}°`;
    });
}

function main() {
  ensureDir(OUT_JSON);
  ensureDir(OUT_TXT);

  const decisionCenter = readJson(INPUTS.decisionCenter, {});
  const stacks = readJson(INPUTS.stacks, {});
  const weather = readJson(INPUTS.weather, {});
  const xPosts = readJson(INPUTS.xPosts, {});

  const decisionRows = asArray(decisionCenter, "decisionCenter");
  const stackRows = asArray(stacks, "stacks");
  const weatherRows = asArray(weather, "weather");
  const xPostRows = asArray(xPosts, "xPosts");

  const queue = [];

  const topPlayers = getTopPlayers(decisionRows);

  if (topPlayers.length) {
    queue.push(buildPost({
      type: "TOP_HR_TARGETS",
      title: "THE SLIP LAB TOP HR TARGETS 🚀",
      minuteOffset: 0,
      bodyLines: topPlayers.map(formatPlayerLine),
      cta: "HR board is live. Pick your spots. 🧪"
    }));
  }

  const valuePlayers = getValuePlayers(decisionRows);

  if (valuePlayers.length) {
    queue.push(buildPost({
      type: "VALUE_HR_TARGETS",
      title: "THE SLIP LAB VALUE HR WATCH 👀",
      minuteOffset: 2,
      bodyLines: valuePlayers.map(formatPlayerLine),
      cta: "Value does not mean lock. It means the number is worth checking."
    }));
  }

  const meatballPlayers = getMeatballPlayers(decisionRows);

  if (meatballPlayers.length) {
    queue.push(buildPost({
      type: "MEATBALL_MATCHUPS",
      title: "THE SLIP LAB MEATBALL MATCHUPS 🍝",
      minuteOffset: 4,
      bodyLines: meatballPlayers.map(formatPlayerLine),
      cta: "Pitcher attack spots to keep on your radar."
    }));
  }

  const stackLines = getStackLines(stackRows);

  if (stackLines.length) {
    queue.push(buildPost({
      type: "TEAM_STACKS",
      title: "THE SLIP LAB TEAM STACK WATCH 🧪",
      minuteOffset: 6,
      bodyLines: stackLines,
      cta: "Best offenses to monitor before lineups lock."
    }));
  }

  const weatherLines = getWeatherLines(weatherRows);

  if (weatherLines.length) {
    queue.push(buildPost({
      type: "WEATHER_BOOSTS",
      title: "THE SLIP LAB WEATHER BOOST SPOTS 🌬️",
      minuteOffset: 8,
      bodyLines: weatherLines,
      cta: "Weather can move the board. Always confirm close to first pitch."
    }));
  }

  for (const post of xPostRows.slice(0, 2)) {
    if (!post?.post) continue;

    queue.push({
      id: `${todayKey()}_${post.type}`,
      date: todayKey(),
      type: post.type,
      status: "queued",
      scheduled_for_eastern: easternIsoForToday(9, 39),
      text: trimPost(post.post),
      graphic: makeGraphicName(post.type),
      posted: false,
      posted_at: null,
      x_post_id: null
    });
  }

  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify({
      date: todayKey(),
      window: "9:30 AM to 9:40 AM Eastern",
      count: queue.length,
      posts: queue
    }, null, 2)
  );

  fs.writeFileSync(
    OUT_TXT,
    queue.map(post => {
      return [
        "========================================",
        post.id,
        post.scheduled_for_eastern,
        post.type,
        "",
        post.text,
        "",
        `Graphic: ${post.graphic}`
      ].join("\n");
    }).join("\n\n")
  );

  console.log("THE SLIP LAB X DAILY QUEUE COMPLETE");
  console.log(`Date: ${todayKey()}`);
  console.log(`Decision center rows: ${decisionRows.length}`);
  console.log(`Stack rows: ${stackRows.length}`);
  console.log(`Weather rows: ${weatherRows.length}`);
  console.log(`X post rows: ${xPostRows.length}`);
  console.log(`Posts queued: ${queue.length}`);
  console.log(`Saved: ${OUT_JSON}`);
  console.log(`Saved: ${OUT_TXT}`);
}

main();
