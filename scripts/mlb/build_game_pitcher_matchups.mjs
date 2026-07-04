import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "website", "data");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function arr(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  return data.games || data.players || data.rows || data.data || [];
}

function clean(v, fallback = "") {
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

function norm(v = "") {
  return clean(v).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function scale(value, min, max) {
  const n = num(value);
  return Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100));
}

async function getPitcherStats(playerId) {
  if (!playerId) return null;

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching`;
  const res = await fetch(url);

  if (!res.ok) return null;

  const data = await res.json();
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};

  return {
    era: num(stat.era),
    whip: num(stat.whip),
    hits: num(stat.hits),
    homeRuns: num(stat.homeRuns),
    inningsPitched: num(stat.inningsPitched),
    strikeOuts: num(stat.strikeOuts),
    walks: num(stat.baseOnBalls)
  };
}

function pitcherVulnerability(stats) {
  if (!stats) return 50;

  const ip = stats.inningsPitched || 1;
  const hitsPer9 = (stats.hits / ip) * 9;
  const hrPer9 = (stats.homeRuns / ip) * 9;
  const walkPressure = stats.walks / ip;

  const score =
    scale(stats.era, 2.5, 7.25) * 0.28 +
    scale(stats.whip, 0.9, 1.85) * 0.26 +
    scale(hitsPer9, 5.5, 12.5) * 0.20 +
    scale(hrPer9, 0.4, 2.3) * 0.18 +
    scale(walkPressure, 0.15, 0.65) * 0.08;

  return Math.max(12, Math.min(98, Math.round(score)));
}

function gameKey(g) {
  return norm(g.matchup || g.game || `${g.awayTeam || g.away} at ${g.homeTeam || g.home}`);
}

function scoreOf(h) {
  const direct = num(
    h.hrVolatilityScore ??
    h.hrConfidence ??
    h.score ??
    h.modelScore ??
    h.aiScore ??
    h.hrScore ??
    h.powerScore ??
    0
  );

  if (direct > 0) return direct;

  const season = h.season || {};
  const model = h.model || {};

  const hr = num(season.hr);
  const slg = num(season.slg);
  const ops = num(season.ops);
  const modelScore = num(model.score);
  const pitcherRisk = num(h.pitcherRisk || model.pitcherRisk);

  const derived =
    hr * 1.4 +
    slg * 28 +
    ops * 16 +
    modelScore * 0.35 +
    pitcherRisk * 0.20;

  return Math.max(1, Math.min(100, Math.round(derived)));
}

function buildLineupMap(lineup) {
  const map = new Map();
  if (!Array.isArray(lineup)) return map;

  for (const row of lineup) {
    const order = num(row.order || row.lineupSpot || row.battingOrder || row.spot);
    const player = clean(row.player || row.name || row.fullName);
    const playerId = clean(row.playerId || row.id || row.mlbId);

    if (!order || order <= 0) continue;

    const entry = {
      order,
      player,
      playerId,
      position: clean(row.position)
    };

    if (player) map.set(norm(player), entry);
    if (playerId) map.set(playerId, entry);
  }

  return map;
}

function findLineupEntry(hitter, lineupMap) {
  const playerId = clean(hitter.playerId || hitter.id || hitter.mlbId);
  const player = clean(hitter.player || hitter.name || hitter.fullName);

  if (playerId && lineupMap.has(playerId)) return lineupMap.get(playerId);
  if (player && lineupMap.has(norm(player))) return lineupMap.get(norm(player));
  return null;
}

function applyLineupData(hitter, lineupMap, lineupStatus) {
  const entry = findLineupEntry(hitter, lineupMap);
  const statusText = String(lineupStatus || "").toUpperCase();
  const confirmed = statusText.includes("CONFIRMED");
  const partial = statusText.includes("PARTIAL");
  const lineupPosted = confirmed || partial || lineupMap.size > 0;

  if (!entry) {
    return {
      ...hitter,
      lineupStatus: lineupPosted ? "NOT IN LINEUP" : lineupStatus,
      confirmedLineup: false,
      confirmedLineupSpot: null,
      lineupSpot: null,
      battingOrder: null,
      actualLineupSpot: null,
      lineupSource: lineupPosted ? "NOT_IN_LINEUP" : "PROJECTED"
    };
  }

  return {
    ...hitter,
    lineupStatus,
    confirmedLineup: confirmed,
    confirmedLineupSpot: entry.order,
    lineupSpot: entry.order,
    battingOrder: entry.order,
    actualLineupSpot: entry.order,
    battingPosition: entry.position || hitter.battingPosition || hitter.position || "",
    lineupSource: confirmed ? "CONFIRMED" : "PARTIAL"
  };
}

const slatePayload = readJSON("mlb_games_today.json", { games: [] });
const poolPayload = readJSON("mlb_player_pool.json", { players: [] });
const hrPayload = readJSON("mlb_home_runs.json", []);

const slateGames = arr(slatePayload);
const poolHitters = arr(poolPayload);
const scoredHitters = arr(hrPayload);

const scoredById = new Map();
const scoredByName = new Map();

for (const h of scoredHitters) {
  if (h.playerId) scoredById.set(String(h.playerId), h);
  if (h.player) scoredByName.set(norm(h.player), h);
}

const hitters = poolHitters.map(h => {
  const scored =
    scoredById.get(String(h.playerId || "")) ||
    scoredByName.get(norm(h.player)) ||
    {};

  return {
    ...h,
    ...scored,
    team: h.team || scored.team,
    opponent: h.opponent || scored.opponent,
    game: h.game || scored.game,
    gamePk: h.gamePk || scored.gamePk,
    playerId: h.playerId || scored.playerId,
    player: h.player || scored.player
  };
});

const groupedHitters = new Map();

for (const hitter of hitters) {
  const key = norm(clean(hitter.game || hitter.matchup));
  if (!key) continue;
  if (!groupedHitters.has(key)) groupedHitters.set(key, []);
  groupedHitters.get(key).push(hitter);
}

const pitcherCache = new Map();

async function getVulnerability(id) {
  const key = String(id || "");
  if (!key) return { score: 50, stats: null };
  if (!pitcherCache.has(key)) {
    const stats = await getPitcherStats(key);
    pitcherCache.set(key, { score: pitcherVulnerability(stats), stats });
  }
  return pitcherCache.get(key);
}

const finalGames = [];
const pitcherRows = [];

for (const slateGame of slateGames) {
  const key = gameKey(slateGame);
  const bats = groupedHitters.get(key) || [];

  const awayTeam = slateGame.awayTeam || slateGame.away || "";
  const homeTeam = slateGame.homeTeam || slateGame.home || "";

  const awayPitcherId = slateGame.awayProbablePitcherId || null;
  const homePitcherId = slateGame.homeProbablePitcherId || null;

  const awayVuln = await getVulnerability(awayPitcherId);
  const homeVuln = await getVulnerability(homePitcherId);

  const awayLineupMap = buildLineupMap(slateGame.awayBattingOrder);
  const homeLineupMap = buildLineupMap(slateGame.homeBattingOrder);

  const awayHitters = bats
    .filter(h => norm(h.team) === norm(awayTeam))
    .map(h => ({
      ...applyLineupData(h, awayLineupMap, slateGame.awayLineupStatus),
      opponent: homeTeam,
      opposingPitcher: clean(slateGame.homeProbablePitcher, "TBD"),
      opposingPitcherId: homePitcherId,
      pitcherRisk: homeVuln.score,
      pitcherVulnerability: homeVuln.score
    }))
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  const homeHitters = bats
    .filter(h => norm(h.team) === norm(homeTeam))
    .map(h => ({
      ...applyLineupData(h, homeLineupMap, slateGame.homeLineupStatus),
      opponent: awayTeam,
      opposingPitcher: clean(slateGame.awayProbablePitcher, "TBD"),
      opposingPitcherId: awayPitcherId,
      pitcherRisk: awayVuln.score,
      pitcherVulnerability: awayVuln.score
    }))
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  const awayPitcher = {
    name: clean(slateGame.awayProbablePitcher, "TBD"),
    pitcher: clean(slateGame.awayProbablePitcher, "TBD"),
    id: awayPitcherId,
    side: clean(slateGame.awayPitcherHand || slateGame.awayProbablePitcherHand),
    team: awayTeam,
    opponent: homeTeam,
    vulnerability: awayVuln.score,
    stats: awayVuln.stats
  };

  const homePitcher = {
    name: clean(slateGame.homeProbablePitcher, "TBD"),
    pitcher: clean(slateGame.homeProbablePitcher, "TBD"),
    id: homePitcherId,
    side: clean(slateGame.homePitcherHand || slateGame.homeProbablePitcherHand),
    team: homeTeam,
    opponent: awayTeam,
    vulnerability: homeVuln.score,
    stats: homeVuln.stats
  };

  pitcherRows.push(awayPitcher, homePitcher);

  finalGames.push({
    ...slateGame,
    game: slateGame.matchup || `${awayTeam} at ${homeTeam}`,
    matchup: slateGame.matchup || `${awayTeam} at ${homeTeam}`,
    awayTeam,
    homeTeam,
    awayPitcher,
    homePitcher,
    hitters: {
      away: awayHitters,
      home: homeHitters
    },
    topThreats: [...awayHitters, ...homeHitters]
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, 5)
      .map(h => ({
        player: h.player,
        team: h.team,
        opponent: h.opponent,
        score: scoreOf(h),
        pitcherRisk: h.pitcherRisk,
        confirmedLineupSpot: h.confirmedLineupSpot || null,
        lineupSpot: h.lineupSpot || h.projectedLineupSpot || h.projectedSpot || null,
        lineupSource: h.lineupSource || "PROJECTED"
      }))
  });
}

writeJSON("game_pitcher_matchups.json", {
  updatedAt: new Date().toISOString(),
  date: slatePayload.date || "",
  count: finalGames.length,
  games: finalGames
});

writeJSON("pitcher_vulnerability.json", {
  updatedAt: new Date().toISOString(),
  date: slatePayload.date || "",
  count: pitcherRows.length,
  pitchers: pitcherRows
});

console.log("");
console.log("GAME PITCHER MATCHUPS COMPLETE");
console.log("Games:", finalGames.length);
console.log("Pitchers:", pitcherRows.length);
console.log("Saved: website/data/game_pitcher_matchups.json");
console.log("Saved: website/data/pitcher_vulnerability.json");
