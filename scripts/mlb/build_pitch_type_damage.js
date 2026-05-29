import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");

const HR_FILE = path.join(DATA_DIR, "mlb_home_runs.json");
const OUT_FILE = path.join(DATA_DIR, "pitch_type_damage.json");
const CACHE_FILE = path.join(DATA_DIR, "pitch_type_damage_cache.json");

const SEASON = new Date().getFullYear();
const START_DATE = `${SEASON}-03-01`;
const END_DATE = new Date().toISOString().slice(0, 10);

const PITCH_LABELS = {
  FF: "4 Seam",
  SI: "Sinker",
  SL: "Slider",
  FC: "Cutter",
  CH: "Changeup",
  CU: "Curveball",
  KC: "Curveball",
  ST: "Sweeper",
  FS: "Splitter"
};

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function rowsFrom(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.rows)) return input.rows;
  if (Array.isArray(input?.data)) return input.data;
  if (Array.isArray(input?.players)) return input.players;
  return [];
}

function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function round(value, places = 3) {
  const mult = 10 ** places;
  return Math.round(n(value) * mult) / mult;
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (quoted && c === '"' && next === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (cell || row.length) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      }
      if (c === "\r" && next === "\n") i++;
    } else {
      cell += c;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows.map(values => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? "";
    });
    return obj;
  });
}

function statcastUrl(playerId) {
  const params = new URLSearchParams();

  params.set("all", "true");
  params.set("type", "details");
  params.set("player_type", "batter");
  params.set("game_date_gt", START_DATE);
  params.set("game_date_lt", END_DATE);
  params.set("hfSea", `${SEASON}|`);
  params.append("batters_lookup[]", String(playerId));

  return `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;
}

async function fetchStatcastRows(playerId) {
  const url = statcastUrl(playerId);

  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    throw new Error(`Statcast failed ${res.status}`);
  }

  const text = await res.text();
  return parseCsv(text);
}

function isBattedBall(row) {
  return clean(row.type) === "X" || clean(row.launch_speed) || clean(row.events);
}

function isBarrel(row) {
  const ev = n(row.launch_speed);
  const la = n(row.launch_angle);

  if (ev < 98) return false;
  if (la < 8 || la > 50) return false;

  return true;
}

function isHardHit(row) {
  return n(row.launch_speed) >= 95;
}

function isWhiff(row) {
  const d = clean(row.description).toLowerCase();
  return d.includes("swinging_strike") || d.includes("swinging strike") || d.includes("foul_tip");
}

function isHr(row) {
  return clean(row.events).toLowerCase() === "home_run";
}

function buildPitchDamage(rows) {
  const groups = new Map();

  for (const row of rows) {
    const pitchType = clean(row.pitch_type);
    if (!PITCH_LABELS[pitchType]) continue;

    if (!groups.has(pitchType)) {
      groups.set(pitchType, {
        label: PITCH_LABELS[pitchType],
        pitches: 0,
        ballsInPlay: 0,
        atBats: 0,
        hits: 0,
        totalBases: 0,
        hr: 0,
        barrels: 0,
        hardHits: 0,
        whiffs: 0,
        xwobaTotal: 0,
        xwobaCount: 0
      });
    }

    const g = groups.get(pitchType);
    g.pitches += 1;

    if (isWhiff(row)) g.whiffs += 1;

    const event = clean(row.events).toLowerCase();
    if (event) {
      const abEvents = new Set([
        "single",
        "double",
        "triple",
        "home_run",
        "field_out",
        "grounded_into_double_play",
        "force_out",
        "field_error",
        "strikeout",
        "strikeout_double_play",
        "fielders_choice",
        "fielders_choice_out"
      ]);

      if (abEvents.has(event)) g.atBats += 1;

      if (event === "single") {
        g.hits += 1;
        g.totalBases += 1;
      }

      if (event === "double") {
        g.hits += 1;
        g.totalBases += 2;
      }

      if (event === "triple") {
        g.hits += 1;
        g.totalBases += 3;
      }

      if (event === "home_run") {
        g.hits += 1;
        g.totalBases += 4;
        g.hr += 1;
      }
    }

    if (isBattedBall(row)) {
      g.ballsInPlay += 1;
      if (isBarrel(row)) g.barrels += 1;
      if (isHardHit(row)) g.hardHits += 1;
    }

    const xwoba = n(row.estimated_woba_using_speedangle, NaN);
    if (Number.isFinite(xwoba)) {
      g.xwobaTotal += xwoba;
      g.xwobaCount += 1;
    }
  }

  const cache = readJson(CACHE_FILE, { players: {} });

  const output = {};

  for (const [pitchType, g] of groups.entries()) {
    if (g.pitches < 8) continue;

    const avg = g.atBats ? g.hits / g.atBats : 0;
    const slg = g.atBats ? g.totalBases / g.atBats : 0;
    const barrel = g.ballsInPlay ? g.barrels / g.ballsInPlay : 0;
    const hardHit = g.ballsInPlay ? g.hardHits / g.ballsInPlay : 0;
    const whiff = g.pitches ? g.whiffs / g.pitches : 0;
    const xwoba = g.xwobaCount ? g.xwobaTotal / g.xwobaCount : 0;

    const crush =
      avg * 14 +
      slg * 24 +
      barrel * 100 * 0.25 +
      hardHit * 100 * 0.18 +
      xwoba * 28 +
      g.hr * 4;

    const key = pitchType === "FF"
      ? "fourSeam"
      : pitchType === "SI"
        ? "sinker"
        : pitchType === "SL"
          ? "slider"
          : pitchType === "FC"
            ? "cutter"
            : pitchType === "CH"
              ? "changeup"
              : pitchType === "FS"
                ? "splitter"
                : pitchType === "ST"
                  ? "sweeper"
                  : "curveball";

    output[key] = {
      label: g.label,
      pitchType,
      pitches: g.pitches,
      ballsInPlay: g.ballsInPlay,
      avg: round(avg),
      slg: round(slg),
      hr: g.hr,
      barrel: round(barrel),
      hardHit: round(hardHit),
      whiff: round(whiff),
      xwoba: round(xwoba),
      crush: round(Math.max(0, Math.min(99, crush)), 2)
    };
  }

  return output;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const players = rowsFrom(readJson(HR_FILE, [])).slice(0, Number(process.env.PITCH_DAMAGE_LIMIT || 60));
  const cache = readJson(CACHE_FILE, { players: {} });

  const output = {
    updated_at: new Date().toISOString(),
    source: "baseball_savant_statcast_pitch_events",
    season: SEASON,
    start_date: START_DATE,
    end_date: END_DATE,
    players: {}
  };

  for (const row of players) {
    const player = clean(row.player);
    const playerId = clean(row.playerId || row.mlbId || row.id);

    if (!player || !playerId) continue;

    try {
      const cacheKey = `${playerId}|${SEASON}`;
      const cached = cache.players?.[cacheKey];

      if (cached?.pitchDamage && cached?.cached_at) {
        output.players[player] = {
          playerId,
          team: row.team || null,
          batSide: row.batSide || null,
          pitchDamage: cached.pitchDamage,
          pitchDamageSource: "real_statcast_pitch_events_cache",
          cached_at: cached.cached_at
        };

        console.log("CACHE", player, Object.keys(cached.pitchDamage).join(", ") || "no sample");
        continue;
      }

      const statcastRows = await fetchStatcastRows(playerId);
      const pitchDamage = buildPitchDamage(statcastRows);

      output.players[player] = {
        playerId,
        team: row.team || null,
        batSide: row.batSide || null,
        pitchDamage,
        pitchDamageSource: Object.keys(pitchDamage).length
          ? "real_statcast_pitch_events"
          : "no_real_pitch_sample"
      };

      cache.players[cacheKey] = {
        player,
        playerId,
        pitchDamage,
        cached_at: new Date().toISOString()
      };

      console.log("OK", player, Object.keys(pitchDamage).join(", ") || "no sample");
      await sleep(150);
    } catch (err) {
      output.players[player] = {
        playerId,
        team: row.team || null,
        batSide: row.batSide || null,
        pitchDamage: {},
        pitchDamageSource: "statcast_fetch_failed",
        error: err.message
      };

      console.log("FAIL", player, err.message);
      await sleep(500);
    }
  }

  writeJson(CACHE_FILE, cache);
  writeJson(OUT_FILE, output);

  console.log("PITCH TYPE DAMAGE COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
