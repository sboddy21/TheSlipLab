import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const WEBSITE_DATA = path.join(ROOT, "website", "data");
const HR_FILE = path.join(WEBSITE_DATA, "mlb_home_runs.json");
const OUT_FILE = path.join(WEBSITE_DATA, "statcast_zones.json");

const LOOKBACK_DAYS = 60;
const MAX_PLAYERS = 30;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function csvSplit(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = csvSplit(lines[0]);

  return lines.slice(1).map(line => {
    const values = csvSplit(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function zoneIndex(rawZone) {
  const zone = Number(rawZone);

  if (!Number.isFinite(zone)) return null;

  const map = {
    1: 6, 2: 7, 3: 8,
    4: 11, 5: 12, 6: 13,
    7: 16, 8: 17, 9: 18,
    11: 0, 12: 1, 13: 2, 14: 3,
    21: 5, 22: 9,
    23: 10, 24: 14,
    31: 15, 32: 19,
    33: 20, 34: 21, 35: 22, 36: 23, 37: 24
  };

  return map[zone] ?? null;
}

function emptyBuckets() {
  return Array.from({ length: 25 }, () => ({
    pitches: 0,
    atBats: 0,
    hits: 0,
    totalBases: 0,
    homeRuns: 0,
    strikeouts: 0,
    hardHits: 0,
    barrels: 0,
    xwobaTotal: 0,
    xwobaCount: 0
  }));
}

function eventBases(event) {
  const value = String(event || "").toLowerCase();

  if (value === "single") return 1;
  if (value === "double") return 2;
  if (value === "triple") return 3;
  if (value === "home_run") return 4;

  return 0;
}

function isAtBat(row) {
  const event = String(row.events || "").toLowerCase();

  if (!event) return false;

  return ![
    "walk",
    "hit_by_pitch",
    "sac_bunt",
    "sac_fly",
    "catcher_interf"
  ].includes(event);
}

function buildZones(rows) {
  const buckets = emptyBuckets();

  rows.forEach(row => {
    const index = zoneIndex(row.zone);
    if (index === null) return;

    const bucket = buckets[index];
    const event = String(row.events || "").toLowerCase();
    const launchSpeed = number(row.launch_speed);
    const launchAngle = number(row.launch_angle);
    const xwoba = number(row.estimated_woba_using_speedangle, null);

    bucket.pitches += 1;

    if (isAtBat(row)) bucket.atBats += 1;

    const bases = eventBases(event);

    if (bases > 0) {
      bucket.hits += 1;
      bucket.totalBases += bases;
    }

    if (event === "home_run") bucket.homeRuns += 1;
    if (event === "strikeout") bucket.strikeouts += 1;
    if (launchSpeed >= 95) bucket.hardHits += 1;
    if (launchSpeed >= 98 && launchAngle >= 8 && launchAngle <= 32) bucket.barrels += 1;

    if (xwoba !== null) {
      bucket.xwobaTotal += xwoba;
      bucket.xwobaCount += 1;
    }
  });

  return {
    avg: buckets.map(b => b.atBats ? b.hits / b.atBats : 0),
    iso: buckets.map(b => b.atBats ? Math.max(0, (b.totalBases / b.atBats) - (b.hits / b.atBats)) : 0),
    slg: buckets.map(b => b.atBats ? b.totalBases / b.atBats : 0),
    xwoba: buckets.map(b => b.xwobaCount ? b.xwobaTotal / b.xwobaCount : 0),
    hr: buckets.map(b => b.homeRuns),
    k: buckets.map(b => b.atBats ? b.strikeouts / b.atBats : 0),
    hardHit: buckets.map(b => b.pitches ? b.hardHits / b.pitches : 0),
    barrel: buckets.map(b => b.pitches ? b.barrels / b.pitches : 0)
  };
}

async function fetchPlayerStatcast(player) {
  const start = isoDateDaysAgo(LOOKBACK_DAYS);
  const end = todayIso();

  const params = new URLSearchParams({
    all: "true",
    type: "details",
    player_type: "batter",
    player_id: String(player.playerId),
    game_date_gt: start,
    game_date_lt: end,
    hfGT: "R|",
    min_pitches: "0",
    min_results: "0",
    group_by: "name",
    sort_col: "pitches",
    sort_order: "desc"
  });

  const url = `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 The Slip Lab"
      }
    });

    if (!response.ok) return [];

    const text = await response.text();
    return parseCsv(text);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackZones(player) {
  const hr = number(player?.stats?.hitter?.hr);
  const slg = number(player?.stats?.hitter?.slg);
  const ops = number(player?.stats?.hitter?.ops);
  const score = number(player?.score);

  const power = Math.min(1, (hr / 20) + (slg / 1.2) + (ops / 2.5) + (score / 200));

  const zones = emptyBuckets().map((bucket, index) => {
    const row = Math.floor(index / 5);
    const col = index % 5;
    const centerBoost = col === 2 ? 0.18 : 0;
    const pullBoost = player.batSide === "L" ? (col >= 3 ? 0.18 : 0) : (col <= 1 ? 0.18 : 0);
    const liftBoost = row <= 2 ? 0.12 : 0;
    const value = Math.max(0, Math.min(1, power * 0.35 + centerBoost + pullBoost + liftBoost));

    return {
      ...bucket,
      pitches: 10,
      atBats: 4,
      hits: value > 0.35 ? 1 : 0,
      totalBases: value > 0.5 ? 2 : 1,
      homeRuns: value > 0.58 ? 1 : 0,
      hardHits: Math.round(value * 5),
      barrels: Math.round(value * 3),
      xwobaTotal: value,
      xwobaCount: 1
    };
  });

  return {
    source: "fallback_model",
    rows: 0,
    zones: buildZonesFromBuckets(zones)
  };
}

function buildZonesFromBuckets(buckets) {
  return {
    avg: buckets.map(b => b.atBats ? b.hits / b.atBats : 0),
    iso: buckets.map(b => b.atBats ? Math.max(0, (b.totalBases / b.atBats) - (b.hits / b.atBats)) : 0),
    slg: buckets.map(b => b.atBats ? b.totalBases / b.atBats : 0),
    xwoba: buckets.map(b => b.xwobaCount ? b.xwobaTotal / b.xwobaCount : 0),
    hr: buckets.map(b => b.homeRuns),
    k: buckets.map(b => b.atBats ? b.strikeouts / b.atBats : 0),
    hardHit: buckets.map(b => b.pitches ? b.hardHits / b.pitches : 0),
    barrel: buckets.map(b => b.pitches ? b.barrels / b.pitches : 0)
  };
}

async function main() {
  const board = readJson(HR_FILE, []);
  const players = board
    .filter(row => row.player && row.playerId)
    .slice(0, MAX_PLAYERS);

  const output = {
    updated_at: new Date().toISOString(),
    lookback_days: LOOKBACK_DAYS,
    source: "baseballsavant_statcast_search",
    players: {}
  };

  for (const player of players) {
    console.log(`Building Statcast zones for ${player.player}`);

    const rows = await fetchPlayerStatcast(player);

    if (rows.length) {
      output.players[player.player] = {
        playerId: player.playerId,
        team: player.team,
        rows: rows.length,
        source: "baseballsavant",
        zones: buildZones(rows)
      };
    } else {
      const fallback = fallbackZones(player);
      output.players[player.player] = {
        playerId: player.playerId,
        team: player.team,
        rows: fallback.rows,
        source: fallback.source,
        zones: fallback.zones
      };
    }
  }

  writeJson(OUT_FILE, output);

  console.log("STATCAST ZONES COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
