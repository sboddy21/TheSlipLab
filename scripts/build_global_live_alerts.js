import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const WEBSITE_DATA = path.join(ROOT, "website/data");

function readJSON(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function toArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.alerts)) return payload.alerts;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function priority(score) {
  if (score >= 90) return "CRITICAL";
  if (score >= 75) return "HIGH";
  if (score >= 60) return "MEDIUM";
  return "LOW";
}

function type(score) {
  if (score >= 90) return "EXPLOSION";
  if (score >= 75) return "CHAIN_REACTION";
  if (score >= 60) return "VOLATILITY";
  return "INFO";
}

console.log("GLOBAL LIVE ALERT ENGINE");
console.log("========================");

const chainPayload = readJSON(
  path.join(
    WEBSITE_DATA,
    "hr_chain_reaction.json"
  ),
  {}
);

const trackerPayload = readJSON(
  path.join(
    WEBSITE_DATA,
    "live_hr_tracker.json"
  ),
  {}
);

const livePayload = readJSON(
  path.join(
    WEBSITE_DATA,
    "live_game_state.json"
  ),
  {}
);

const chainGames = toArray(chainPayload);
const trackerGames = toArray(trackerPayload);
const liveGames = toArray(livePayload);

const trackerMap = {};

for (const row of trackerGames) {
  trackerMap[row.game] = row;
}

const liveMap = {};

for (const row of liveGames) {
  liveMap[row.game] = row;
}

const alerts = [];

for (const game of chainGames) {
  const tracker =
    trackerMap[game.game] || {};

  const live =
    liveMap[game.game] || {};

  const masterScore =
    (
      num(game.chainReactionScore) * 0.35 +
      num(game.inningExplosionRisk) * 0.25 +
      num(game.rapidFireHrProbability) * 0.2 +
      num(live.leverageScore) * 0.2
    );

  if (masterScore < 55) {
    continue;
  }

  alerts.push({
    game: game.game,

    score:
      Number(masterScore.toFixed(1)),

    priority:
      priority(masterScore),

    type:
      type(masterScore),

    message:
      masterScore >= 90
        ? "MULTI HR INNING RISK DETECTED"
        : masterScore >= 75
        ? "CHAIN REACTION ACTIVE"
        : "VOLATILITY BUILDING",

    leverageScore:
      num(live.leverageScore),

    chainReactionScore:
      num(game.chainReactionScore),

    inningExplosionRisk:
      num(game.inningExplosionRisk),

    rapidFireHrProbability:
      num(game.rapidFireHrProbability),

    liveVolatility:
      num(tracker.liveVolatility),

    timestamp:
      new Date().toISOString()
  });
}

alerts.sort(
  (a, b) =>
    num(b.score) - num(a.score)
);

fs.writeFileSync(
  path.join(
    WEBSITE_DATA,
    "global_live_alerts.json"
  ),
  JSON.stringify(
    {
      updatedAt:
        new Date().toISOString(),

      count:
        alerts.length,

      alerts
    },
    null,
    2
  )
);

console.log("");
console.log("GLOBAL LIVE ALERT ENGINE COMPLETE");
console.log(`Alerts: ${alerts.length}`);

console.table(
  alerts.slice(0, 15).map(alert => ({
    game: alert.game,
    score: alert.score,
    priority: alert.priority,
    type: alert.type
  }))
);

console.log("");
console.log(
  `Saved: ${path.join(
    WEBSITE_DATA,
    "global_live_alerts.json"
  )}`
);
