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
  if (Array.isArray(payload.stacks)) return payload.stacks;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function norm(value = "") {
  return String(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function gameKey(row) {
  const home = row.homeTeam || row.home_team || row.home || "";
  const away = row.awayTeam || row.away_team || row.away || "";

  if (home && away) {
    return `${norm(away)} @ ${norm(home)}`;
  }

  return norm(row.game || row.matchup || "");
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dedupeRows(rows, scoreField = "score") {
  const map = new Map();

  for (const row of rows) {
    const key = gameKey(row);
    if (!key) continue;

    const current = map.get(key);

    if (!current) {
      map.set(key, row);
      continue;
    }

    const currentScore =
      num(current[scoreField]) ||
      num(current.leverageScore) ||
      num(current.chainReactionScore) ||
      num(current.liveVolatility);

    const nextScore =
      num(row[scoreField]) ||
      num(row.leverageScore) ||
      num(row.chainReactionScore) ||
      num(row.liveVolatility);

    if (nextScore >= currentScore) {
      map.set(key, row);
    }
  }

  return [...map.values()];
}

function writePayload(file, key, rows) {
  fs.writeFileSync(
    path.join(WEBSITE_DATA, file),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        count: rows.length,
        [key]: rows
      },
      null,
      2
    )
  );
}

console.log("LIVE DUPLICATE CLEANUP");
console.log("======================");

const liveRows = dedupeRows(
  toArray(readJSON(path.join(WEBSITE_DATA, "live_game_state.json"), {})),
  "leverageScore"
);

const chainRows = dedupeRows(
  toArray(readJSON(path.join(WEBSITE_DATA, "hr_chain_reaction.json"), {})),
  "chainReactionScore"
);

const trackerRows = dedupeRows(
  toArray(readJSON(path.join(WEBSITE_DATA, "live_hr_tracker.json"), {})),
  "liveVolatility"
);

const alertRows = dedupeRows(
  toArray(readJSON(path.join(WEBSITE_DATA, "global_live_alerts.json"), {})),
  "score"
);

writePayload("live_game_state.json", "games", liveRows);
writePayload("hr_chain_reaction.json", "games", chainRows);
writePayload("live_hr_tracker.json", "games", trackerRows);
writePayload("global_live_alerts.json", "alerts", alertRows);

console.log("");
console.log("DUPLICATE CLEANUP COMPLETE");
console.log(`Live Games: ${liveRows.length}`);
console.log(`Chain Games: ${chainRows.length}`);
console.log(`Tracker Games: ${trackerRows.length}`);
console.log(`Alerts: ${alertRows.length}`);

console.log("");
console.log("Saved cleaned live files.");
