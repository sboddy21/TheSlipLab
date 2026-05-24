import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");

const OUT = path.join(DATA, "player_spray_charts.json");
const HR_FILE = path.join(DATA, "mlb_home_runs.json");

const SEASON = new Date().getFullYear();
const START_DATE = `${SEASON}-03-01`;
const END_DATE = new Date().toISOString().slice(0, 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.players)) return data.players;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function clean(value) {
  return String(value || "").trim();
}

function csvParse(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quote && next === '"') {
      value += '"';
      i++;
      continue;
    }

    if (char === '"') {
      quote = !quote;
      continue;
    }

    if (char === "," && !quote) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quote) {
      if (value !== "" || row.length) {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      }

      if (char === "\r" && next === "\n") i++;
      continue;
    }

    value += char;
  }

  if (value !== "" || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function csvObjects(text) {
  const parsed = csvParse(text);
  const header = parsed.shift() || [];

  return parsed.map(row => {
    const obj = {};
    header.forEach((key, index) => {
      obj[key] = row[index] ?? "";
    });
    return obj;
  });
}

function eventType(row) {
  const event = clean(row.events).toLowerCase();

  if (event.includes("home_run")) return "hr";
  if (event.includes("double") || event.includes("triple")) return "xbh";
  if (event.includes("single")) return "hit";
  if (event) return "out";

  return "bip";
}

function savantUrl(playerId) {
  const params = new URLSearchParams({
    all: "true",
    type: "details",
    player_type: "batter",
    game_date_gt: START_DATE,
    game_date_lt: END_DATE,
    "batters_lookup[]": String(playerId)
  });

  return `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;
}

async function fetchPlayerSpray(player) {
  const url = savantUrl(player.playerId);
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 TheSlipLab/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Statcast failed ${response.status}`);
  }

  const text = await response.text();
  const data = csvObjects(text);

  const points = data
    .filter(row => clean(row.hc_x) && clean(row.hc_y))
    .map(row => ({
      date: row.game_date,
      gamePk: row.game_pk,
      event: row.events || row.description || "batted_ball",
      type: eventType(row),
      x: Number(row.hc_x),
      y: Number(row.hc_y),
      exitVelocity: row.launch_speed ? Number(row.launch_speed) : null,
      launchAngle: row.launch_angle ? Number(row.launch_angle) : null,
      distance: row.hit_distance_sc ? Number(row.hit_distance_sc) : null,
      pitchType: row.pitch_type || "",
      pitchName: row.pitch_name || "",
      pitcher: row.player_name || "",
      inning: row.inning || ""
    }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

  const homeRuns = points.filter(p => p.type === "hr").length;
  const hits = points.filter(p => p.type === "hr" || p.type === "xbh" || p.type === "hit").length;

  return {
    player: player.player,
    playerId: player.playerId,
    team: player.team,
    updatedAt: new Date().toISOString(),
    source: "Baseball Savant Statcast",
    window: {
      start: START_DATE,
      end: END_DATE
    },
    summary: {
      battedBalls: points.length,
      hits,
      homeRuns
    },
    points
  };
}

const board = rows(readJSON(HR_FILE, []))
  .filter(row => row.player && row.playerId);

const unique = new Map();

for (const row of board) {
  unique.set(String(row.playerId), {
    player: row.player,
    playerId: row.playerId,
    team: row.team
  });
}

const players = [...unique.values()];

const existing = readJSON(OUT, {});
const output = {
  updatedAt: new Date().toISOString(),
  source: "Baseball Savant Statcast",
  players: existing.players || {},
  byPlayerId: existing.byPlayerId || {}
};

console.log("SPRAY CHART BUILD");
console.log("Players:", players.length);
console.log("Window:", START_DATE, "to", END_DATE);

let ok = 0;
let failed = 0;

for (const player of players) {
  try {
    const chart = await fetchPlayerSpray(player);

    output.players[player.player] = chart;
    output.byPlayerId[String(player.playerId)] = chart;

    ok++;
    console.log("OK", player.player, chart.points.length, "points");

    await sleep(350);
  } catch (error) {
    failed++;
    console.log("FAIL", player.player, error.message);

    if (!output.players[player.player]) {
      output.players[player.player] = {
        player: player.player,
        playerId: player.playerId,
        team: player.team,
        updatedAt: new Date().toISOString(),
        source: "Baseball Savant Statcast",
        error: error.message,
        points: []
      };
    }

    await sleep(700);
  }
}

output.count = Object.keys(output.players).length;
output.success = ok;
output.failed = failed;

writeJSON(OUT, output);

console.log("");
console.log("SPRAY CHARTS COMPLETE");
console.log("OK:", ok);
console.log("Failed:", failed);
console.log("Saved:", OUT);
