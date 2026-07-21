import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");

const PLAYER_POOL_FILE = path.join(DATA_DIR, "mlb_player_pool.json");
const OUT_FILE = path.join(DATA_DIR, "pitch_type_damage.json");
const CACHE_FILE = path.join(DATA_DIR, "pitch_type_damage_cache.json");
const FETCH_CONCURRENCY = 4;
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function easternDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

const SLATE_DATE = easternDate();
const SEASON = Number(SLATE_DATE.slice(0, 4));
const START_DATE = `${SEASON}-03-01`;
const END_DATE = SLATE_DATE;

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
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0"
        }
      });

      if (res.ok) {
        const text = await res.text();
        return parseCsv(text);
      }

      const error = new Error(`Statcast failed ${res.status}`);
      error.retryable = res.status === 429 || res.status >= 500;
      lastError = error;
    } catch (error) {
      error.retryable = true;
      lastError = error;
    }

    if (!lastError.retryable || attempt === MAX_FETCH_ATTEMPTS) {
      throw lastError;
    }

    const delay = RETRY_DELAY_MS * attempt;
    console.warn(
      `RETRY Statcast player ${playerId} after attempt ${attempt}/${MAX_FETCH_ATTEMPTS}: ` +
      `${lastError.message}; waiting ${delay}ms`
    );
    await sleep(delay);
  }

  throw lastError || new Error("Statcast request failed without an error response");
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
  const playerPool = readJson(PLAYER_POOL_FILE, null);
  const players = rowsFrom(playerPool);

  if (!players.length) {
    if (playerPool?.availability !== "no_games_scheduled" || playerPool?.date !== SLATE_DATE) {
      throw new Error("mlb_player_pool.json contains no current players");
    }

    const cache = readJson(CACHE_FILE, { players: {} });
    if (!cache.players || typeof cache.players !== "object" || Array.isArray(cache.players)) {
      throw new Error("pitch_type_damage_cache.json has an invalid players object");
    }

    writeJson(CACHE_FILE, cache);
    writeJson(OUT_FILE, {
      updated_at: new Date().toISOString(),
      source: "baseball_savant_statcast_pitch_events",
      availability: "no_games_scheduled",
      season: SEASON,
      start_date: START_DATE,
      end_date: END_DATE,
      players: {}
    });

    console.log("PITCH TYPE DAMAGE COMPLETE");
    console.log("Availability: no games scheduled");
    console.log("Players: 0");
    console.log(`Saved: ${OUT_FILE}`);
    return;
  }

  if (playerPool?.date !== SLATE_DATE) {
    throw new Error(`mlb_player_pool.json date is ${playerPool?.date || "missing"}; expected ${SLATE_DATE}`);
  }

  const cache = readJson(CACHE_FILE, { players: {} });
  if (!cache.players || typeof cache.players !== "object" || Array.isArray(cache.players)) {
    throw new Error("pitch_type_damage_cache.json has an invalid players object");
  }

  const output = {
    updated_at: new Date().toISOString(),
    source: "baseball_savant_statcast_pitch_events",
    season: SEASON,
    start_date: START_DATE,
    end_date: END_DATE,
    players: {}
  };

  const preparedPlayers = players.map((row, index) => {
    const player = clean(row.player);
    const playerId = clean(row.playerId || row.mlbId || row.id);

    if (!player || !playerId) {
      throw new Error(`${player || "unknown player"}: missing MLB player ID; existing outputs were not replaced`);
    }

    return { index, row, player, playerId };
  });

  const playerIdsByName = new Map();
  for (const { player, playerId } of preparedPlayers) {
    const existingId = playerIdsByName.get(player);
    if (existingId && existingId !== playerId) {
      throw new Error(
        `Pitch type damage cannot key two MLB player IDs by the same name ${player}: ${existingId}, ${playerId}`
      );
    }
    playerIdsByName.set(player, playerId);
  }
  const expectedPlayerCount = playerIdsByName.size;

  const results = new Array(preparedPlayers.length);
  const uncached = [];

  for (const item of preparedPlayers) {
    const { index, row, player, playerId } = item;
    const cacheKey = `${playerId}|${SEASON}`;
    const cached = cache.players?.[cacheKey];
    const cacheDate = easternDate(cached?.cached_at);

    if (cached?.pitchDamage && cacheDate === SLATE_DATE) {
      results[index] = {
        player,
        value: {
          playerId,
          team: row.team || null,
          batSide: row.batSide || null,
          pitchDamage: cached.pitchDamage,
          pitchDamageSource: "real_statcast_pitch_events_cache",
          cached_at: cached.cached_at
        }
      };

      console.log("CACHE", player, Object.keys(cached.pitchDamage).join(", ") || "no sample");
    } else {
      uncached.push({ ...item, cacheKey });
    }
  }

  let cursor = 0;
  let firstFailure = null;

  async function worker() {
    while (!firstFailure) {
      const taskIndex = cursor++;
      if (taskIndex >= uncached.length) return;

      const { index, row, player, playerId, cacheKey } = uncached[taskIndex];

      try {
        const statcastRows = await fetchStatcastRows(playerId);
        const pitchDamage = buildPitchDamage(statcastRows);
        const cachedAt = new Date().toISOString();

        results[index] = {
          player,
          value: {
            playerId,
            team: row.team || null,
            batSide: row.batSide || null,
            pitchDamage,
            pitchDamageSource: Object.keys(pitchDamage).length
              ? "real_statcast_pitch_events"
              : "no_real_pitch_sample"
          },
          cacheKey,
          cacheValue: {
            player,
            playerId,
            pitchDamage,
            cached_at: cachedAt
          }
        };

        console.log("OK", player, Object.keys(pitchDamage).join(", ") || "no sample");
        await sleep(150);
      } catch (err) {
        console.log("FAIL", player, err.message);
        firstFailure = new Error(
          `Pitch type damage refresh failed for ${player}; existing outputs were not replaced: ${err.message}`
        );
      }
    }
  }

  const workerCount = Math.min(FETCH_CONCURRENCY, uncached.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstFailure) {
    throw firstFailure;
  }

  for (const result of results) {
    if (!result) {
      throw new Error("Pitch type damage did not complete every current player; existing outputs were not replaced");
    }

    output.players[result.player] = result.value;

    if (result.cacheKey) {
      cache.players[result.cacheKey] = result.cacheValue;
    }
  }

  console.log(
    `Pitch damage sources: ${players.length - uncached.length} current cache, ${uncached.length} live fetches, concurrency ${workerCount}`
  );

  /*
   * Cache and output writes intentionally remain below the complete-player check.
   * A failed live request therefore cannot replace production data with a partial file.
   */
  if (Object.keys(output.players).length !== expectedPlayerCount) {
    throw new Error(
      `Pitch type damage produced ${Object.keys(output.players).length} players for ` +
      `${expectedPlayerCount} unique players in a ${players.length}-row pool`
    );
  }

  writeJson(CACHE_FILE, cache);
  writeJson(OUT_FILE, output);

  console.log("PITCH TYPE DAMAGE COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
