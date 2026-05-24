import fs from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "website", "data");

const BAD = new Set([
  "",
  "TBD",
  "Probable SP Pending",
  "Pitcher Not Loaded",
  "Unknown",
  "--"
]);

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

function norm(v = "") {
  return String(v).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rows(d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return [];
  if (Array.isArray(d.players)) return d.players;
  if (Array.isArray(d.games)) return d.games;
  if (Array.isArray(d.rows)) return d.rows;
  if (Array.isArray(d.data)) return d.data;
  return [];
}

function splitGame(game = "") {
  if (game.includes(" at ")) {
    const [awayTeam, homeTeam] = game.split(" at ");
    return { awayTeam, homeTeam };
  }
  if (game.includes(" @ ")) {
    const [awayTeam, homeTeam] = game.split(" @ ");
    return { awayTeam, homeTeam };
  }
  return { awayTeam: "", homeTeam: "" };
}

const profiles = rows(readJSON("player_card_profiles.json", { players: [] }));
const hr = rows(readJSON("mlb_home_runs.json", []));

const pitcherByGameTeam = new Map();

for (const p of profiles) {
  if (!p.game || !p.pitcher || BAD.has(p.pitcher)) continue;

  const { awayTeam, homeTeam } = splitGame(p.game);

  const pitcherTeam =
    norm(p.team) === norm(awayTeam) ? homeTeam :
    norm(p.team) === norm(homeTeam) ? awayTeam :
    p.opponent;

  if (!pitcherTeam) continue;

  pitcherByGameTeam.set(`${norm(p.game)}|${norm(pitcherTeam)}`, p.pitcher);
}

for (const r of hr) {
  const pitcher = r.opposingPitcher;
  if (!r.game || !pitcher || BAD.has(pitcher)) continue;

  pitcherByGameTeam.set(`${norm(r.game)}|${norm(r.opponent)}`, pitcher);
}

function resolvePitcher(obj) {
  const game = obj.game || obj.matchup || "";
  const team =
    obj.pitcherTeam ||
    obj.team ||
    obj.opponentTeam ||
    obj.opponent ||
    "";

  if (game && team) {
    const direct = pitcherByGameTeam.get(`${norm(game)}|${norm(team)}`);
    if (direct) return direct;
  }

  for (const [key, pitcher] of pitcherByGameTeam.entries()) {
    const [gameKey, teamKey] = key.split("|");

    if (
      gameKey &&
      teamKey &&
      norm(game).includes(gameKey) &&
      norm(team).includes(teamKey)
    ) {
      return pitcher;
    }
  }

  return "";
}

function fixObject(obj) {
  if (!obj || typeof obj !== "object") return 0;

  let fixed = 0;
  const resolved = resolvePitcher(obj);

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (value && typeof value === "object") {
      fixed += fixObject(value);
      continue;
    }

    const keyLooksPitcher =
      /pitcher|probable|starter|sp|name|player|title/i.test(key);

    if (
      resolved &&
      keyLooksPitcher &&
      typeof value === "string" &&
      BAD.has(value)
    ) {
      obj[key] = resolved;
      fixed++;
    }
  }

  return fixed;
}

const files = fs
  .readdirSync(DATA)
  .filter(f => f.endsWith(".json"));

let total = 0;

for (const file of files) {
  const full = path.join(DATA, file);
  let data;

  try {
    data = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    continue;
  }

  const fixed = fixObject(data);

  if (fixed > 0) {
    writeJSON(file, data);
    console.log("fixed", fixed, file);
    total += fixed;
  }
}

console.log("TOTAL PITCHER PLACEHOLDERS FIXED:", total);
