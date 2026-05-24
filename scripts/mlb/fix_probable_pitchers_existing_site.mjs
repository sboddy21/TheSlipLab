import fs from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "website", "data");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(data, null, 2));
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.players)) return data.players;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.allPlayers)) return data.allPlayers;
  return [];
}

function badPitcher(value) {
  const v = String(value || "").toLowerCase();
  return !v || v === "tbd" || v.includes("pending") || v.includes("not loaded");
}

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const hrRows = rows(readJSON("mlb_home_runs.json", []));
const profiles = rows(readJSON("player_card_profiles.json", { players: [] }));
const advanced = rows(readJSON("advanced_player_intelligence.json", []));

const pitcherByGameOpponent = new Map();

for (const row of [...hrRows, ...profiles, ...advanced]) {
  const pitcher =
    row.opposingPitcher ||
    row.pitcher ||
    row.probablePitcher ||
    "";

  if (badPitcher(pitcher)) continue;

  const game = row.game || "";
  const opponent = row.opponent || "";

  if (!game || !opponent) continue;

  pitcherByGameOpponent.set(`${norm(game)}|${norm(opponent)}`, pitcher);
}

function resolvePitcher(row) {
  const game = row.game || "";
  const opponent = row.opponent || row.team || "";

  return pitcherByGameOpponent.get(`${norm(game)}|${norm(opponent)}`) || "";
}

function fixRows(file) {
  const data = readJSON(file, null);
  if (!data) return 0;

  const list = rows(data);
  let fixed = 0;

  for (const row of list) {
    const resolved = resolvePitcher(row);
    if (!resolved) continue;

    for (const key of Object.keys(row)) {
      const lk = key.toLowerCase();

      if (
        (lk.includes("pitcher") || lk.includes("starter") || lk.includes("sp")) &&
        typeof row[key] === "string" &&
        badPitcher(row[key])
      ) {
        row[key] = resolved;
        fixed++;
      }
    }

    if (badPitcher(row.pitcher)) {
      row.pitcher = resolved;
      fixed++;
    }

    if (badPitcher(row.opposingPitcher)) {
      row.opposingPitcher = resolved;
      fixed++;
    }
  }

  if (fixed > 0) writeJSON(file, data);

  return fixed;
}

const files = fs.readdirSync(DATA).filter(file => file.endsWith(".json"));
let total = 0;

for (const file of files) {
  const fixed = fixRows(file);
  if (fixed) {
    console.log("fixed", fixed, file);
    total += fixed;
  }
}

console.log("TOTAL FIXED:", total);
