import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const WEBSITE_DATA_DIR = path.join(ROOT, "website", "data");

const OUT_WEB = path.join(WEBSITE_DATA_DIR, "statcast_zones.json");
const SOURCE = "baseball_savant_statcast_pitch_detail_csv";
const FETCH_CONCURRENCY = 4;

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

const PLAYER_POOL_FILE = path.join(WEBSITE_DATA_DIR, "mlb_player_pool.json");
const MATCHUPS_FILE = path.join(WEBSITE_DATA_DIR, "game_pitcher_matchups.json");

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

function getArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.players)) return raw.players;
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function cleanName(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function collectPlayers() {
  const seen = new Map();
  const pool = readJson(PLAYER_POOL_FILE);

  if (pool?.date !== SLATE_DATE) {
    throw new Error(`mlb_player_pool.json date is ${pool?.date || "missing"}; expected ${SLATE_DATE}`);
  }

  for (const row of getArray(pool)) {
    const name = cleanName(row.player || row.name || row.fullName || row.batter || "");
    const id = row.playerId || row.id || row.personId || row.mlbId || row.mlb_id;

    if (!name || !id) {
      throw new Error(`${name || "unknown player"} is missing a player name or MLB ID`);
    }

    if (seen.has(String(id))) {
      throw new Error(`Duplicate MLB player ID ${id} in mlb_player_pool.json`);
    }

    seen.set(String(id), {
      player: name,
      playerId: Number(id),
      team: row.team || row.teamName || row.currentTeam || "",
      batSide: row.batSide || row.bats || ""
    });
  }

  const players = [...seen.values()].sort((a, b) => a.player.localeCompare(b.player));
  if (!players.length) throw new Error("mlb_player_pool.json contains no current players");
  return players;
}

function collectPitchers() {
  const matchups = readJson(MATCHUPS_FILE);
  if (matchups?.date !== SLATE_DATE) {
    throw new Error(`game_pitcher_matchups.json date is ${matchups?.date || "missing"}; expected ${SLATE_DATE}`);
  }

  const games = Array.isArray(matchups?.games) ? matchups.games : [];
  if (!games.length) throw new Error("game_pitcher_matchups.json contains no current games");

  const seen = new Map();

  for (const game of games) {
    for (const side of ["away", "home"]) {
      const profile = game[`${side}Pitcher`] || {};
      const pitcherId = profile.id || profile.playerId || game[`${side}ProbablePitcherId`];
      const pitcher = cleanName(
        profile.name || profile.pitcher || game[`${side}ProbablePitcher`] || ""
      );

      if (!pitcherId || !pitcher || pitcher === "TBD") {
        throw new Error(`${game.matchup || game.game || "current game"} is missing a confirmed ${side} pitcher`);
      }

      seen.set(String(pitcherId), {
        pitcher,
        pitcherId: Number(pitcherId),
        team: side === "away" ? game.awayTeam : game.homeTeam,
        opponent: side === "away" ? game.homeTeam : game.awayTeam
      });
    }
  }

  return [...seen.values()].sort((a, b) => a.pitcher.localeCompare(b.pitcher));
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

async function fetchStatcast(playerId, playerType) {
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
  params.set("player_type", playerType);
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
  params.append(playerType === "pitcher" ? "pitchers_lookup[]" : "batters_lookup[]", String(playerId));
  params.set("hfFlag", "");
  params.set("metric_1", "");
  params.set("hfInn", "");
  params.set("min_pitches", "0");
  params.set("min_results", "0");
  params.set("group_by", "");
  params.set("sort_col", "game_date");
  params.set("player_event_sort", "api_p_release_speed");
  params.set("sort_order", "desc");
  params.set("min_pas", "0");
  params.set("type", "details");

  const url = `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      accept: "text/csv,*/*",
      "user-agent": "Mozilla/5.0 TheSlipLab Statcast Zone Engine"
    }
  });

  if (!res.ok) {
    throw new Error(`Baseball Savant failed ${res.status}`);
  }

  const text = await res.text();
  if (!text || !text.includes("pitch_type")) {
    throw new Error("Baseball Savant returned an invalid Statcast CSV response");
  }

  return parseCsv(text).filter(row => row.plate_x !== undefined || row.zone !== undefined);
}

async function fetchWithRetries(playerId, playerType, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchStatcast(playerId, playerType);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 750);
    }
  }

  throw lastError;
}

function number(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function zoneIndexFromLocation(px, pz) {
  if (px === null || pz === null) return null;

  if (px < -1.75 || px > 1.75) return null;
  if (pz < 0.75 || pz > 4.25) return null;

  const col = Math.min(4, Math.max(0, Math.floor(((px + 1.75) / 3.5) * 5)));
  const row = Math.min(4, Math.max(0, Math.floor(((4.25 - pz) / 3.5) * 5)));

  return row * 5 + col;
}

function zoneIndexFromSavantZone(zone) {
  const z = Number(zone);
  if (!Number.isFinite(z)) return null;

  const map = {
    1: 6, 2: 7, 3: 8,
    4: 11, 5: 12, 6: 13,
    7: 16, 8: 17, 9: 18,
    11: 0, 12: 4, 13: 20, 14: 24
  };

  return map[z] ?? null;
}

function zoneIndex(row) {
  const fromLocation = zoneIndexFromLocation(number(row.plate_x), number(row.plate_z));
  if (fromLocation !== null) return fromLocation;
  return zoneIndexFromSavantZone(row.zone);
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
    "intent_walk",
    "hit_by_pitch",
    "sac_fly",
    "sac_bunt",
    "catcher_interf"
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
    const idx = zoneIndex(row);
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
    const barrelClass = number(row.launch_speed_angle);

    if (ev !== null) {
      cell.bbe++;
      if (ev >= 95) cell.hardHit++;
      if (barrelClass === 6) cell.barrels++;
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

  return { avg, iso, slg, xwoba, hr, k, hardHit, barrel, raw: cells };
}

function validZoneCard(card, playerId) {
  if (!card || String(card.playerId || card.mlbId || "") !== String(playerId)) return false;
  if (easternDate(card.cached_at) !== SLATE_DATE) return false;

  const zones = card.zones;
  if (!zones || typeof zones !== "object") return false;

  for (const metric of ["avg", "iso", "slg", "xwoba", "hr", "k", "hardHit", "barrel", "raw"]) {
    if (!Array.isArray(zones[metric]) || zones[metric].length !== 25) return false;
  }

  return true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  ensureDir(WEBSITE_DATA_DIR);

  const playerPool = readJson(PLAYER_POOL_FILE);
  const matchups = readJson(MATCHUPS_FILE);
  if (
    playerPool?.availability === "no_games_scheduled" &&
    matchups?.availability === "no_games_scheduled" &&
    playerPool?.date === SLATE_DATE &&
    matchups?.date === SLATE_DATE
  ) {
    const completedAt = new Date().toISOString();
    fs.writeFileSync(OUT_WEB, JSON.stringify({
      date: SLATE_DATE,
      season: SEASON,
      availability: "no_games_scheduled",
      playerCount: 0,
      source: SOURCE,
      note: "No games scheduled; no current Statcast zone profiles were requested.",
      pitcherCount: 0,
      players: {},
      pitchers: {},
      updated_at: completedAt,
      generatedAt: completedAt,
      playersWithRows: 0,
      playersWithZones: 0,
      pitchersWithRows: 0,
      pitchersWithZones: 0
    }, null, 2));
    console.log("STATCAST ZONE ENGINE COMPLETE");
    console.log("Availability: no games scheduled");
    console.log("Players: 0");
    console.log("Pitchers: 0");
    console.log("Saved:", OUT_WEB);
    return;
  }

  const players = collectPlayers();
  const pitchers = collectPitchers();
  const previous = readJson(OUT_WEB);
  const canReusePrevious = previous?.source === SOURCE && previous?.date === SLATE_DATE;

  const output = {
    date: SLATE_DATE,
    season: SEASON,
    playerCount: players.length,
    source: SOURCE,
    note: "Real Baseball Savant Statcast pitch-detail events grouped into a 5x5 plate-location grid.",
    pitcherCount: pitchers.length,
    players: {},
    pitchers: {}
  };

  console.log("STATCAST ZONE ENGINE");
  console.log("Players queued:", players.length);
  console.log("Pitchers queued:", pitchers.length);
  console.log("Fetch workers:", FETCH_CONCURRENCY);

  let done = 0;
  const totalProfiles = players.length + pitchers.length;
  const uncached = [];

  for (const player of players) {
    const cached = canReusePrevious ? previous.players?.[player.player] : null;
    if (validZoneCard(cached, player.playerId)) {
      output.players[player.player] = cached;
      done++;
      console.log(`[${done}/${totalProfiles}] CACHE BATTER: ${player.player} ${player.playerId}`);
      continue;
    }

    uncached.push({ kind: "batter", id: player.playerId, name: player.player, profile: player });
  }

  for (const pitcher of pitchers) {
    const cached = canReusePrevious ? previous.pitchers?.[String(pitcher.pitcherId)] : null;
    if (validZoneCard(cached, pitcher.pitcherId)) {
      output.pitchers[String(pitcher.pitcherId)] = cached;
      done++;
      console.log(`[${done}/${totalProfiles}] CACHE PITCHER: ${pitcher.pitcher} ${pitcher.pitcherId}`);
      continue;
    }

    uncached.push({ kind: "pitcher", id: pitcher.pitcherId, name: pitcher.pitcher, profile: pitcher });
  }

  let nextIndex = 0;
  let failure = null;

  async function worker() {
    while (!failure) {
      const index = nextIndex;
      nextIndex++;
      if (index >= uncached.length) return;

      const item = uncached[index];
      console.log(`Fetching ${item.kind}: ${item.name} ${item.id}`);

      let statcastRows;
      try {
        statcastRows = await fetchWithRetries(item.id, item.kind);
      } catch (error) {
        failure = new Error(
          `Statcast zone refresh failed for ${item.name}; existing output was not replaced: ${error.message}`
        );
        return;
      }

      const zones = buildMetricZones(statcastRows);
      const zonePitchCount = zones.raw.reduce((sum, cell) => sum + cell.pitches, 0);

      const common = {
        mlbId: item.id,
        playerId: item.id,
        rows: statcastRows.length,
        zonePitchCount,
        source: zonePitchCount ? SOURCE : "no_real_statcast_sample",
        cached_at: new Date().toISOString(),
        zones
      };

      if (item.kind === "pitcher") {
        output.pitchers[String(item.id)] = {
          ...common,
          pitcher: item.profile.pitcher,
          pitcherId: item.id,
          team: item.profile.team,
          opponent: item.profile.opponent
        };
      } else {
        output.players[item.profile.player] = {
          ...common,
          player: item.profile.player,
          team: item.profile.team,
          batSide: item.profile.batSide
        };
      }

      done++;
      console.log(`[${done}/${totalProfiles}] OK ${item.kind}: ${item.name} rows ${statcastRows.length} zones ${zonePitchCount}`);
      await sleep(250);
    }
  }

  const workerCount = Math.min(FETCH_CONCURRENCY, uncached.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failure) throw failure;
  if (Object.keys(output.players).length !== players.length) {
    throw new Error(
      `Statcast zone engine produced ${Object.keys(output.players).length} players for a ${players.length}-player pool`
    );
  }
  if (Object.keys(output.pitchers).length !== pitchers.length) {
    throw new Error(
      `Statcast zone engine produced ${Object.keys(output.pitchers).length} pitchers for ${pitchers.length} current pitchers`
    );
  }

  const outputRows = Object.values(output.players);
  const outputPitchers = Object.values(output.pitchers);
  const withRows = outputRows.filter(row => Number(row.rows) > 0).length;
  const withZones = outputRows.filter(row => Number(row.zonePitchCount) > 0).length;
  const pitchersWithRows = outputPitchers.filter(row => Number(row.rows) > 0).length;
  const pitchersWithZones = outputPitchers.filter(row => Number(row.zonePitchCount) > 0).length;
  const completedAt = new Date().toISOString();

  output.updated_at = completedAt;
  output.generatedAt = completedAt;
  output.playersWithRows = withRows;
  output.playersWithZones = withZones;
  output.pitchersWithRows = pitchersWithRows;
  output.pitchersWithZones = pitchersWithZones;

  fs.writeFileSync(OUT_WEB, JSON.stringify(output, null, 2));

  console.log("STATCAST ZONE ENGINE COMPLETE");
  console.log("Players:", players.length);
  console.log("Players with Statcast rows:", withRows);
  console.log("Players with zone pitches:", withZones);
  console.log("Pitchers:", pitchers.length);
  console.log("Pitchers with Statcast rows:", pitchersWithRows);
  console.log("Pitchers with zone pitches:", pitchersWithZones);
  console.log("Saved:", OUT_WEB);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
