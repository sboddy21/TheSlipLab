import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const DATA_DIR = path.join(ROOT, "data");
const WEBSITE_DATA_DIR = path.join(ROOT, "website", "data");

const OUT_DATA = path.join(DATA_DIR, "statcast_zones.json");
const OUT_WEB = path.join(WEBSITE_DATA_DIR, "statcast_zones.json");

const SEASON = new Date().getFullYear();

const SOURCE_FILES = [
  path.join(WEBSITE_DATA_DIR, "mlb_home_runs.json"),
  path.join(WEBSITE_DATA_DIR, "hr_board.json"),
  path.join(WEBSITE_DATA_DIR, "home_run_board.json"),
  path.join(WEBSITE_DATA_DIR, "top_hr_plays.json"),
  path.join(DATA_DIR, "hr_board.json"),
  path.join(DATA_DIR, "master_hr_model.json")
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function pickRows() {
  for (const file of SOURCE_FILES) {
    const raw = readJson(file);

    if (!raw) continue;

    const rows = Array.isArray(raw) ? raw : raw.rows || raw.players || raw.data || raw.plays || [];

    if (Array.isArray(rows) && rows.length) {
      return rows.slice(0, 40);
    }
  }

  return [];
}

function cleanName(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

async function getMlbPlayerId(name) {
  const q = encodeURIComponent(cleanName(name));
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${q}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const json = await res.json();
    const people = json.people || [];

    const exact = people.find(p => cleanName(p.fullName).toLowerCase() === cleanName(name).toLowerCase());

    return exact?.id || people[0]?.id || null;
  } catch {
    return null;
  }
}

function csvSplit(line) {
  const out = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      quoted = !quoted;
      continue;
    }

    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = csvSplit(lines[0]);

  return lines.slice(1).map(line => {
    const cells = csvSplit(line);
    const row = {};

    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });

    return row;
  });
}

async function fetchBatterStatcast(playerId) {
  const start = `${SEASON}-03-01`;
  const end = `${SEASON}-11-30`;

  const params = new URLSearchParams({
    all: "true",
    hfPT: "",
    hfAB: "",
    hfGT: "R|",
    hfPR: "",
    hfZ: "",
    stadium: "",
    hfBBL: "",
    hfNewZones: "",
    hfPull: "",
    hfC: "",
    hfSea: `${SEASON}|`,
    hfSit: "",
    player_type: "batter",
    hfOuts: "",
    opponent: "",
    pitcher_throws: "",
    batter_stands: "",
    hfSA: "",
    game_date_gt: start,
    game_date_lt: end,
    hfInfield: "",
    team: "",
    position: "",
    hfOutfield: "",
    hfRO: "",
    home_road: "",
    batters_lookup: String(playerId),
    hfFlag: "",
    metric_1: "",
    hfInn: "",
    min_pitches: "0",
    min_results: "0",
    group_by: "name",
    sort_col: "pitches",
    player_event_sort: "h_launch_speed",
    sort_order: "desc",
    min_abs: "0",
    type: "details"
  });

  const url = `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "TheSlipLab/1.0"
      }
    });

    if (!res.ok) return [];

    const text = await res.text();
    return parseCsv(text);
  } catch {
    return [];
  }
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function zoneIndex(px, pz) {
  if (px === null || pz === null) return null;

  if (px < -1.5 || px > 1.5) return null;
  if (pz < 1.0 || pz > 4.0) return null;

  const col = Math.min(4, Math.max(0, Math.floor(((px + 1.5) / 3.0) * 5)));
  const row = Math.min(4, Math.max(0, Math.floor(((4.0 - pz) / 3.0) * 5)));

  return row * 5 + col;
}

function isHit(event = "") {
  return ["single", "double", "triple", "home_run"].includes(event);
}

function totalBases(event = "") {
  if (event === "single") return 1;
  if (event === "double") return 2;
  if (event === "triple") return 3;
  if (event === "home_run") return 4;
  return 0;
}

function isAtBat(event = "") {
  return Boolean(event) && ![
    "walk",
    "hit_by_pitch",
    "sac_fly",
    "sac_bunt",
    "catcher_interf",
    "field_error"
  ].includes(event);
}

function isStrikeout(event = "") {
  return event === "strikeout" || event === "strikeout_double_play";
}

function buildMetricZones(rows) {
  const cells = Array.from({ length: 25 }, () => ({
    pitches: 0,
    ab: 0,
    hits: 0,
    tb: 0,
    hr: 0,
    k: 0,
    xwobaTotal: 0,
    xwobaCount: 0,
    hardHit: 0,
    barrels: 0,
    bbe: 0
  }));

  for (const row of rows) {
    const px = number(row.plate_x);
    const pz = number(row.plate_z);
    const idx = zoneIndex(px, pz);

    if (idx === null) continue;

    const cell = cells[idx];
    const event = row.events || "";

    cell.pitches++;

    if (isAtBat(event)) cell.ab++;
    if (isHit(event)) cell.hits++;
    if (isStrikeout(event)) cell.k++;

    cell.tb += totalBases(event);
    if (event === "home_run") cell.hr++;

    const xwoba = number(row.estimated_woba_using_speedangle);
    if (xwoba !== null) {
      cell.xwobaTotal += xwoba;
      cell.xwobaCount++;
    }

    const ev = number(row.launch_speed);
    const la = number(row.launch_angle);

    if (ev !== null && la !== null) {
      cell.bbe++;
      if (ev >= 95) cell.hardHit++;
      if (ev >= 98 && la >= 8 && la <= 32) cell.barrels++;
    }
  }

  const avg = cells.map(c => c.ab ? c.hits / c.ab : 0);
  const slg = cells.map(c => c.ab ? c.tb / c.ab : 0);
  const iso = cells.map((c, i) => Math.max(0, slg[i] - avg[i]));
  const xwoba = cells.map(c => c.xwobaCount ? c.xwobaTotal / c.xwobaCount : 0);
  const hr = cells.map(c => c.hr);
  const k = cells.map(c => c.ab ? c.k / c.ab : 0);
  const hardHit = cells.map(c => c.bbe ? c.hardHit / c.bbe : 0);
  const barrel = cells.map(c => c.bbe ? c.barrels / c.bbe : 0);

  return {
    avg,
    iso,
    slg,
    xwoba,
    hr,
    k,
    hardHit,
    barrel,
    raw: cells
  };
}

async function main() {
  ensureDir(DATA_DIR);
  ensureDir(WEBSITE_DATA_DIR);

  const rows = pickRows();

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    source: "Baseball Savant Statcast CSV plus MLB Stats API player search",
    players: {}
  };

  console.log("STATCAST ZONE ENGINE");
  console.log("Players queued:", rows.length);

  for (const row of rows) {
    const player = cleanName(row.player || row.name || row.batter || "");

    if (!player) continue;

    const id = row.playerId || row.player_id || row.mlbId || row.mlb_id || await getMlbPlayerId(player);

    if (!id) {
      console.log("NO MLB ID:", player);
      continue;
    }

    console.log("Fetching:", player, id);

    const statcastRows = await fetchBatterStatcast(id);
    const zones = buildMetricZones(statcastRows);

    output.players[player] = {
      player,
      mlbId: id,
      rows: statcastRows.length,
      zones
    };

    await new Promise(resolve => setTimeout(resolve, 350));
  }

  fs.writeFileSync(OUT_DATA, JSON.stringify(output, null, 2));
  fs.writeFileSync(OUT_WEB, JSON.stringify(output, null, 2));

  console.log("STATCAST ZONE ENGINE COMPLETE");
  console.log("Players:", Object.keys(output.players).length);
  console.log("Saved:", OUT_WEB);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
