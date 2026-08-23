import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");

const OUT = path.join(DATA, "player_card_data.json");
const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_WARNINGS = 50;
const warnings = [];
const warningKeys = new Set();
let warningCount = 0;

function warn(message) {
  if (warningKeys.has(message)) return;
  warningKeys.add(message);
  warningCount++;
  if (warnings.length < MAX_OUTPUT_WARNINGS) warnings.push(message);
  console.warn(`PLAYER CARD WARNING: ${message}`);
}

async function fetchJson(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) return res.json();
      lastError = new Error(`${label} returned ${res.status}`);
      if (res.status !== 429 && res.status < 500) throw lastError;
    } catch (error) {
      lastError = error;
      if (/ returned 4\d\d$/.test(error.message) && !error.message.endsWith("429")) throw error;
    }
    if (attempt < FETCH_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, attempt * 500));
  }
  throw lastError || new Error(`${label} failed`);
}

let gameLogFailureStreak = 0;
let gameLogCircuitOpen = false;
let splitsFailureStreak = 0;
let splitsCircuitOpen = false;

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function arr(x) {
  if (Array.isArray(x)) return x;
  return x?.allPlayers || x?.players || x?.rows || x?.data || x?.matchups || x?.games || [];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function key(v) {
  return String(v || "").trim().toLowerCase();
}

function calcGames(games) {
  let hr = 0;
  let hits = 0;
  let ab = 0;
  let bb = 0;
  let hbp = 0;
  let sf = 0;
  let tb = 0;
  let rbi = 0;
  let k = 0;
  let runs = 0;

  for (const game of games) {
    const s = game.stat || {};
    hr += num(s.homeRuns);
    hits += num(s.hits);
    ab += num(s.atBats);
    bb += num(s.baseOnBalls);
    hbp += num(s.hitByPitch);
    sf += num(s.sacFlies);
    tb += num(s.totalBases);
    rbi += num(s.rbi);
    k += num(s.strikeOuts);
    runs += num(s.runs);
  }

  const avg = ab ? hits / ab : 0;
  const obpDen = ab + bb + hbp + sf;
  const obp = obpDen ? (hits + bb + hbp) / obpDen : 0;
  const slg = ab ? tb / ab : 0;
  const ops = obp + slg;
  const iso = slg - avg;

  return {
    games: games.length,
    hr,
    hits,
    ab,
    rbi,
    runs,
    k,
    avg: Number(avg.toFixed(3)),
    obp: Number(obp.toFixed(3)),
    slg: Number(slg.toFixed(3)),
    ops: Number(ops.toFixed(3)),
    iso: Number(iso.toFixed(3))
  };
}

async function fetchGameLog(playerId) {
  if (gameLogCircuitOpen) return null;
  const season = new Date().getFullYear();
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}`;

  try {
    const json = await fetchJson(url, "MLB game log");
    gameLogFailureStreak = 0;
    return (json?.stats?.[0]?.splits || [])
      .filter(row => row?.stat)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  } catch {
    gameLogFailureStreak++;
    if (gameLogFailureStreak >= 3) {
      gameLogCircuitOpen = true;
      warn("MLB game-log circuit opened after 3 consecutive failures; using validated cache for remaining players");
    }
    return null;
  }
}

async function fetchSeasonSplits(playerId) {
  if (splitsCircuitOpen) return null;
  const season = new Date().getFullYear();
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr,d,n`;

  try {
    const json = await fetchJson(url, "MLB splits");
    splitsFailureStreak = 0;
    const rows = json?.stats?.[0]?.splits || [];
    return Object.fromEntries(rows.map(row => {
      const stat = row.stat || {};
      return [row.split?.code, {
        pa: num(stat.plateAppearances),
        ab: num(stat.atBats),
        hits: num(stat.hits),
        hr: num(stat.homeRuns),
        avg: num(stat.avg),
        obp: num(stat.obp),
        slg: num(stat.slg),
        ops: num(stat.ops)
      }];
    }));
  } catch {
    splitsFailureStreak++;
    if (splitsFailureStreak >= 3) {
      splitsCircuitOpen = true;
      warn("MLB splits circuit opened after 3 consecutive failures; using validated cache for remaining players");
    }
    return null;
  }
}

const pitcherHandCache = new Map();

export async function fetchPitcherHand(playerId) {
  if (!playerId) return "";
  const id = String(playerId);
  if (!/^\d+$/.test(id)) {
    warn(`Ignoring invalid opposing pitcher ID ${JSON.stringify(id)}`);
    return "";
  }
  if (!pitcherHandCache.has(id)) {
    pitcherHandCache.set(id, (async () => {
      try {
        const json = await fetchJson(`https://statsapi.mlb.com/api/v1/people/${id}`, "MLB player bio");
        return json?.people?.[0]?.pitchHand?.code || "";
      } catch (error) {
        warn(`Pitcher hand unavailable for MLB ID ${id}: ${error.message}`);
        return "";
      }
    })());
  }
  return pitcherHandCache.get(id);
}

function collectPlayers() {
  const map = new Map();
  const playerIdByName = new Map();

  const homeRuns = arr(readJSON(path.join(DATA, "mlb_home_runs.json"), []));
  const decision = arr(readJSON(path.join(DATA, "hr_decision_center.json"), {}));
  const matchups = arr(readJSON(path.join(DATA, "game_pitcher_matchups.json"), {}));
  const liveGames = arr(readJSON(path.join(DATA, "mlb_games_live.json"), {}));

  function add(row, extra = {}) {
    const player = row.player || row.name;
    const playerId = row.playerId || row.mlbId || row.id || playerIdByName.get(key(player));

    if (!player || !playerId) return;

    const id = String(playerId);
    playerIdByName.set(key(player), id);
    map.set(id, {
      ...(map.get(id) || {}),
      ...row,
      ...extra,
      player,
      playerId
    });
  }

  for (const row of homeRuns) add(row);

  for (const game of liveGames) {
    for (const side of ["away", "home"]) {
      const pitcher = side === "away" ? game.homePitcher : game.awayPitcher;
      for (const row of game?.hitters?.[side] || []) add(row, {
        opposingPitcher: row.opposingPitcher || pitcher?.name,
        opposingPitcherId: pitcher?.id || row.opposingPitcherId,
        opposingPitcherHand: pitcher?.side || pitcher?.throws || row.opposingPitcherHand
      });
    }
  }

  for (const game of matchups) {
    for (const row of game.hitters?.away || []) {
      add(row, {
        venue: game.venue,
        gameDate: game.gameDate,
        lineupStatus: game.awayLineupStatus,
        opposingPitcher: row.opposingPitcher || game.homePitcher?.name,
        opposingPitcherId: game.homePitcher?.id || row.opposingPitcherId,
        opposingPitcherHand: game.homePitcher?.side || game.homePitcher?.throws || row.opposingPitcherHand
      });
    }

    for (const row of game.hitters?.home || []) {
      add(row, {
        venue: game.venue,
        gameDate: game.gameDate,
        lineupStatus: game.homeLineupStatus,
        opposingPitcher: row.opposingPitcher || game.awayPitcher?.name,
        opposingPitcherId: game.awayPitcher?.id || row.opposingPitcherId,
        opposingPitcherHand: game.awayPitcher?.side || game.awayPitcher?.throws || row.opposingPitcherHand
      });
    }
  }

  // Decision Center is the exclusive owner of matchup confidence, pitch edge,
  // due, zones, and context scores. Apply it last so matchup rows cannot mask
  // those fields, including when Decision Center rows identify players by name.
  for (const row of decision) add(row);

  return [...map.values()];
}

function buildTags(row, last7, last15) {
  const tags = [];
  const h = row.hitterStats || row.stats?.hitter || row.stats || {};

  if (num(row.score || row.hrConfidence) >= 50) tags.push("ELITE MODEL");
  if (num(h.hr) >= 10) tags.push("POWER BAT");
  if (num(h.slg) >= 0.5) tags.push("SLG EDGE");
  if (num(h.ops) >= 0.85) tags.push("OPS EDGE");
  if (last7.hr >= 1) tags.push("RECENT HR");
  if (last7.ops >= 0.85) tags.push("HOT L7");
  if (last15.hr >= 3) tags.push("POWER TREND");
  if (num(row.hotZoneCount) >= 4) tags.push("ZONE POWER");

  if (!tags.length) tags.push("MATCHUP WATCH");

  return tags;
}

function buildSlateSignals(row, last7) {
  const hrConfidence = num(row.hrConfidence ?? row.score);
  const pitchEdge = num(row.pitchEdge);
  const barrelScore = num(row.barrelScore);
  const hardHitScore = num(row.hardHitScore);
  const recentHr = num(last7.hr);
  const signals = [];

  if (hrConfidence >= 52) {
    signals.push({
      key: "hotLook",
      emoji: "🔥",
      label: "Hot Look",
      evidence: { hrConfidence }
    });
  }

  if (recentHr >= 2) {
    signals.push({
      key: "hotLately",
      emoji: "☄️",
      label: "Hot Lately",
      evidence: { last7HomeRuns: recentHr, last7Games: num(last7.games) }
    });
  }

  if (barrelScore >= 80 && hardHitScore >= 75 && recentHr === 0) {
    signals.push({
      key: "due",
      emoji: "🎯",
      label: "Due",
      evidence: { barrelScore, hardHitScore, last7HomeRuns: recentHr, last7Games: num(last7.games) }
    });
  }

  if (hrConfidence >= 42 && hrConfidence < 52 && pitchEdge >= 55 && recentHr === 0) {
    signals.push({
      key: "sleeper",
      emoji: "👀",
      label: "Sleeper Matchup",
      evidence: { hrConfidence, pitchEdge, last7HomeRuns: recentHr, last7Games: num(last7.games) }
    });
  }

  return signals;
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });

  const players = collectPlayers();
  const previous = readJSON(OUT, {});
  const previousById = new Map(arr(previous).map(player => [String(player.playerId), player]));
  const output = [];
  let cachedPlayerCount = 0;
  let skippedPlayerCount = 0;

  console.log("PLAYER CARD DATA BUILDER");
  console.log("Players queued:", players.length);

  let i = 0;

  for (const player of players) {
    i++;
    console.log(`[${i}/${players.length}] ${player.player}`);

    const cached = previousById.get(String(player.playerId));
    const [logs, liveSplits, opposingPitcherHand] = await Promise.all([
      fetchGameLog(player.playerId),
      fetchSeasonSplits(player.playerId),
      player.opposingPitcherHand ? player.opposingPitcherHand : fetchPitcherHand(player.opposingPitcherId)
    ]);
    if (logs === null && !cached?.last7) {
      skippedPlayerCount++;
      warn(`Skipping ${player.player}: live game log unavailable and no validated cache exists`);
      continue;
    }
    const usingCachedLogs = logs === null;
    if (usingCachedLogs) {
      cachedPlayerCount++;
      warn(`Using cached recent form for ${player.player}: live game log unavailable`);
    }
    const last7Games = logs?.slice(0, 7) || [];
    const last15Games = logs?.slice(0, 15) || [];

    const last7 = usingCachedLogs ? cached.last7 : calcGames(last7Games);
    const last15 = usingCachedLogs ? cached.last15 : calcGames(last15Games);
    const splits = liveSplits || {
      vl: cached?.splits?.vsLhp || null,
      vr: cached?.splits?.vsRhp || null,
      d: cached?.splits?.day || null,
      n: cached?.splits?.night || null
    };
    if (liveSplits === null) warn(`Using cached or empty splits for ${player.player}: live splits unavailable`);
    const cachedPitcherMatches = cached && (
      (player.opposingPitcherId && String(cached.opposingPitcherId || "") === String(player.opposingPitcherId)) ||
      (player.opposingPitcher && key(cached.opposingPitcher) === key(player.opposingPitcher))
    );
    const resolvedPitcherHand = opposingPitcherHand || (cachedPitcherMatches ? cached.opposingPitcherHand : "") || "";

    const h = player.hitterStats || player.stats?.hitter || player.stats || {};
    const recentStatcastForm = player.recentStatcastForm || cached?.recentStatcastForm || null;
    const barrelRate = recentStatcastForm?.season?.barrelRate ?? cached?.barrelRate ?? null;
    const hardHitRate = recentStatcastForm?.season?.hardHitRate ?? cached?.hardHitRate ?? null;

    output.push({
      player: player.player,
      playerId: player.playerId,
      team: player.team,
      opponent: player.opponent,
      game: player.game,
      venue: player.venue,
      opposingPitcher: player.opposingPitcher,
      opposingPitcherId: player.opposingPitcherId,
      opposingPitcherHand: resolvedPitcherHand,
      batSide: player.batSide || player.bats || player.batHand,
      lineupStatus: player.lineupStatus,
      barrelRate,
      hardHitRate,
      recentStatcastForm,

      splits: {
        vsLhp: splits.vl || null,
        vsRhp: splits.vr || null,
        day: splits.d || null,
        night: splits.n || null
      },

      season: {
        hr: num(h.hr),
        hits: num(h.hits),
        doubles: num(h.doubles),
        triples: num(h.triples),
        rbi: num(h.rbi),
        avg: num(h.avg),
        obp: num(h.obp),
        slg: num(h.slg),
        ops: num(h.ops),
        ab: num(h.atBats),
        pa: num(h.plateAppearances),
        k: num(h.strikeOuts)
      },

      last7,
      last15,

      model: {
        score: num(player.hrConfidence ?? player.score),
        powerScore: num(player.powerScore),
        pitchEdge: num(player.pitchEdge),
        pitcherRisk: num(player.pitcherRisk),
        weather: num(player.weather),
        bullpen: num(player.bullpen),
        due: num(player.due),
        barrelScore: num(player.barrelScore),
        hardHitScore: num(player.hardHitScore),
        zoneOverlap: num(player.zoneOverlap),
        hitterZonePower: num(player.hitterZonePower),
        pitcherLeak: num(player.pitcherLeak),
        hotZoneCount: num(player.hotZoneCount),
        tier: player.tier || player.edge || ""
      },

      slateSignals: buildSlateSignals(player, last7),

      tags: buildTags(player, last7, last15),
      gameLogs: usingCachedLogs ? (cached.gameLogs || []) : last7Games.map(game => ({
        date: game.date,
        opponent: game.opponent?.name || "",
        ab: num(game.stat?.atBats),
        hits: num(game.stat?.hits),
        hr: num(game.stat?.homeRuns),
        rbi: num(game.stat?.rbi),
        tb: num(game.stat?.totalBases),
        k: num(game.stat?.strikeOuts)
      }))
    });

    await new Promise(resolve => setTimeout(resolve, 120));
  }

  const minimumPlayers = Math.max(1, Math.floor(players.length * 0.5));
  if (output.length < minimumPlayers) {
    throw new Error(`Player-card output failed minimum coverage: ${output.length}/${players.length} players`);
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    count: output.length,
    sourceStatus: warningCount ? "degraded" : "live",
    cachedPlayerCount,
    skippedPlayerCount,
    warningCount,
    warningsTruncated: warningCount > warnings.length,
    warnings,
    players: output
  };
  const temporary = `${OUT}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2));
  fs.renameSync(temporary, OUT);

  console.log("PLAYER CARD DATA COMPLETE");
  console.log("Players:", output.length);
  console.log("Saved:", OUT);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
