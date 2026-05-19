import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const WEBSITE_DATA_DIR = path.join(ROOT, "website", "data");

const OUT_DATA = path.join(DATA_DIR, "statcast_zones.json");
const OUT_WEB = path.join(WEBSITE_DATA_DIR, "statcast_zones.json");

const SEASON = new Date().getFullYear();
const START_DATE = `${SEASON}-03-01`;
const END_DATE = `${SEASON}-11-30`;

const PLAYER_POOL_FILE = path.join(WEBSITE_DATA_DIR, "mlb_player_pool.json");
const HR_FILE = path.join(WEBSITE_DATA_DIR, "mlb_home_runs.json");

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

function cleanName(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function getArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.players)) return raw.players;
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function collectPlayers() {
  const seen = new Map();

  const sources = [
    getArray(readJson(PLAYER_POOL_FILE)),
    getArray(readJson(HR_FILE))
  ];

  for (const rows of sources) {
    for (const row of rows) {
      const name = cleanName(row.player || row.name || row.fullName || row.batter || "");
      const id = row.playerId || row.id || row.personId || row.mlbId || row.mlb_id;

      if (!name || !id) continue;

      seen.set(String(id), {
        player: name,
        playerId: Number(id),
        team: row.team || row.teamName || row.currentTeam || "",
        batSide: row.batSide || row.bats || ""
      });
    }
  }

  return [...seen.values()].sort((a, b) => a.player.localeCompare(b.player));
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
  const params = new URLSearchParams();

  params.set("all", "true");
  params.set("hfPT", "");
  params.set("hfAB", "");
  params.set("hfGT", "R|");
  params.set("hfPR", "");
  params.set("hfZ", "");
  params.set("stadium", "");
  params.set("hfBBL", "");
  params.set("hfNewZones", "");
  params.set("hfPull", "");
  params.set("hfC", "");
  params.set("hfSea", `${SEASON}|`);
  params.set("hfSit", "");
  params.set("player_type", "batter");
  params.set("hfOuts", "");
  params.set("opponent", "");
  params.set("pitcher_throws", "");
  params.set("batter_stands", "");
  params.set("hfSA", "");
  params.set("game_date_gt", START_DATE);
  params.set("game_date_lt", END_DATE);
  params.set("hfInfield", "");
  params.set("team", "");
  params.set("position", "");
  params.set("hfOutfield", "");
  params.set("hfRO", "");
  params.set("home_road", "");
  params.set("batters_lookup[]", String(playerId));
  params.set("hfFlag", "");
  params.set("metric_1", "");
  params.set("hfInn", "");
  params.set("min_pitches", "0");
  params.set("min_results", "0");
  params.set("group_by", "name");
  params.set("sort_col", "pitches");
  params.set("player_event_sort", "api_p_release_speed");
  params.set("sort_order", "desc");
  params.set("min_pas", "0");
  params.set("type", "details");

  const urls = [
    `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`,
    `https://baseballsavant.mlb.com/statcast_search/csv-docs?${params.toString()}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "accept": "text/csv,*/*",
          "user-agent": "Mozilla/5.0 TheSlipLab Statcast Zone Engine"
        }
      });

      if (!res.ok) continue;

      const text = await res.text();

      if (!text || !text.includes("pitch_type")) continue;

      return parseCsv(text);
    } catch {}
  }

  return [];
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function zoneIndex(px, pz) {
  if (px === null || pz === null) return null;

  if (px < -1.75 || px > 1.75) return null;
  if (pz < 0.75 || pz > 4.25) return null;

  const col = Math.min(4, Math.max(0, Math.floor(((px + 1.75) / 3.5) * 5)));
  const row = Math.min(4, Math.max(0, Math.floor(((4.25 - pz) / 3.5) * 5)));

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

  const players = collectPlayers();

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    playerCount: players.length,
    source: "Baseball Savant Statcast CSV plus MLB player pool",
    players: {}
  };

  console.log("STATCAST ZONE ENGINE");
  console.log("Players queued:", players.length);

  let done = 0;

  for (const player of players) {
    done++;

    console.log(`[${done}/${players.length}] Fetching: ${player.player} ${player.playerId}`);

    const statcastRows = await fetchBatterStatcast(player.playerId);
    const zones = buildMetricZones(statcastRows);

    output.players[player.player] = {
      player: player.player,
      mlbId: player.playerId,
      team: player.team,
      batSide: player.batSide,
      rows: statcastRows.length,
      zones
    };

    await new Promise(resolve => setTimeout(resolve, 250));
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
