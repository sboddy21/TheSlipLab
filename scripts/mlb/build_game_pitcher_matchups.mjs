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

function inningsToOuts(value) {
  const text = clean(value).trim();
  const match = text.match(/^(\d+)(?:\.([012]))?$/);
  if (!match) return null;
  return Number(match[1]) * 3 + Number(match[2] || 0);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) throw new Error("Cannot calibrate pitcher vulnerability without live pitcher stats");
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function getPitcherStats(playerId) {
  if (!playerId) return null;

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching`;
  const res = await fetch(url);

  if (!res.ok) return null;

  const data = await res.json();
  const stat = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!stat) return null;

  const outs = inningsToOuts(stat.inningsPitched);
  if (!outs) return null;
  const innings = outs / 3;
  const hits = num(stat.hits);
  const homeRuns = num(stat.homeRuns);
  const strikeOuts = num(stat.strikeOuts);
  const walks = num(stat.baseOnBalls);

  return {
    era: num(stat.era),
    whip: num(stat.whip),
    hits,
    homeRuns,
    inningsPitched: clean(stat.inningsPitched),
    strikeOuts,
    walks,
    kPer9: Number(((strikeOuts / innings) * 9).toFixed(2)),
    bbPer9: Number(((walks / innings) * 9).toFixed(2)),
    hPer9: Number(((hits / innings) * 9).toFixed(2)),
    hrPer9: Number(((homeRuns / innings) * 9).toFixed(2))
  };
}

function rawPitcherVulnerability(stats) {
  if (!stats) throw new Error("Pitcher vulnerability requires live MLB season stats");
  const outs = inningsToOuts(stats.inningsPitched);
  if (!outs) throw new Error("Pitcher vulnerability requires a positive MLB innings sample");
  const ip = outs / 3;
  const hitsPer9 = (stats.hits / ip) * 9;
  const hrPer9 = (stats.homeRuns / ip) * 9;
  const walkPressure = stats.walks / ip;

  const score =
    scale(stats.era, 2.5, 7.25) * 0.28 +
    scale(stats.whip, 0.9, 1.85) * 0.26 +
    scale(hitsPer9, 5.5, 12.5) * 0.20 +
    scale(hrPer9, 0.4, 2.3) * 0.18 +
    scale(walkPressure, 0.15, 0.65) * 0.08;

  return Math.max(0, Math.min(100, score));
}

function pitcherVulnerability(stats, liveSlateMedian) {
  const rawScore = rawPitcherVulnerability(stats);
  const outs = inningsToOuts(stats.inningsPitched);
  const trueInnings = outs / 3;
  const sampleWeight = Math.min(1, trueInnings / 60);
  const stabilized = liveSlateMedian + (rawScore - liveSlateMedian) * sampleWeight;

  return {
    score: Math.max(12, Math.min(98, Math.round(stabilized))),
    rawScore: Number(rawScore.toFixed(2)),
    sampleWeight: Number(sampleWeight.toFixed(4)),
    trueInnings: Number(trueInnings.toFixed(3))
  };
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

const allSlateGames = arr(slatePayload);
const poolHitters = arr(poolPayload);
const scoredHitters = arr(hrPayload);
const analysisGamePks = new Set(
  poolHitters
    .map(hitter => clean(hitter.gamePk))
    .filter(Boolean)
);

if (!analysisGamePks.size) {
  if (
    !allSlateGames.length &&
    poolPayload?.availability === "no_games_scheduled" &&
    poolPayload?.date === slatePayload?.date
  ) {
    const updatedAt = new Date().toISOString();
    writeJSON("game_pitcher_matchups.json", {
      updatedAt,
      date: slatePayload.date,
      availability: "no_games_scheduled",
      vulnerabilityModel: {
        source: "MLB Stats API live season pitching",
        scale: "0-100 risk index; not a probability",
        liveSlateMedian: null,
        fullSampleInnings: 60
      },
      count: 0,
      games: []
    });
    writeJSON("pitcher_vulnerability.json", {
      updatedAt,
      date: slatePayload.date,
      availability: "no_games_scheduled",
      source: "MLB Stats API live season pitching",
      scale: "0-100 risk index; not a probability",
      liveSlateMedian: null,
      fullSampleInnings: 60,
      count: 0,
      pitchers: []
    });
    console.log("");
    console.log("GAME PITCHER MATCHUPS COMPLETE");
    console.log("Availability: no games scheduled");
    console.log("Games: 0");
    console.log("Pitchers: 0");
    console.log("Saved: website/data/game_pitcher_matchups.json");
    console.log("Saved: website/data/pitcher_vulnerability.json");
    process.exit(0);
  }

  throw new Error("Current player pool contains no canonical analysis game IDs");
}

const slateGames = allSlateGames.filter(game => analysisGamePks.has(clean(game.gamePk)));

if (slateGames.length !== analysisGamePks.size) {
  throw new Error(
    `Current player pool references ${analysisGamePks.size} analysis games, but only ${slateGames.length} exist in mlb_games_today.json`
  );
}

for (const game of allSlateGames) {
  if (!analysisGamePks.has(clean(game.gamePk))) {
    console.log(
      `Skipping non-canonical doubleheader analysis game: ${game.matchup || game.gamePk} ` +
      `gamePk ${game.gamePk}`
    );
  }
}

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

const probablePitcherIds = [...new Set(slateGames.flatMap(game => [
  game.awayProbablePitcherId,
  game.homeProbablePitcherId
]).filter(Boolean).map(String))];

if (probablePitcherIds.length !== slateGames.length * 2) {
  throw new Error(
    `Current analysis slate has ${probablePitcherIds.length} probable pitcher IDs for ${slateGames.length} games`
  );
}

const pitcherStatsById = new Map();
const unavailablePitcherIds = new Set();
for (const id of probablePitcherIds) {
  const stats = await getPitcherStats(id);
  if (stats) pitcherStatsById.set(id, stats);
  else unavailablePitcherIds.add(id);
}

const liveSlateMedian = median([...pitcherStatsById.values()].map(rawPitcherVulnerability));
const pitcherCache = new Map([...pitcherStatsById.entries()].map(([id, stats]) => {
  return [id, { ...pitcherVulnerability(stats, liveSlateMedian), stats, available: true, status: "available" }];
}));
for (const id of unavailablePitcherIds) {
  pitcherCache.set(id, {
    score: null,
    rawScore: null,
    sampleWeight: null,
    trueInnings: null,
    stats: null,
    available: false,
    status: "updating"
  });
}

async function getVulnerability(id) {
  const key = String(id || "");
  if (!key || !pitcherCache.has(key)) {
    throw new Error(`Missing live vulnerability inputs for probable pitcher ${key || "TBD"}`);
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
      pitcherVulnerability: homeVuln.score,
      pitcherRiskAvailable: homeVuln.available
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
      pitcherVulnerability: awayVuln.score,
      pitcherRiskAvailable: awayVuln.available
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
    vulnerabilityRaw: awayVuln.rawScore,
    vulnerabilitySampleWeight: awayVuln.sampleWeight,
    vulnerabilityTrueInnings: awayVuln.trueInnings,
    stats: awayVuln.stats,
    available: awayVuln.available,
    status: awayVuln.status
  };

  const homePitcher = {
    name: clean(slateGame.homeProbablePitcher, "TBD"),
    pitcher: clean(slateGame.homeProbablePitcher, "TBD"),
    id: homePitcherId,
    side: clean(slateGame.homePitcherHand || slateGame.homeProbablePitcherHand),
    team: homeTeam,
    opponent: awayTeam,
    vulnerability: homeVuln.score,
    vulnerabilityRaw: homeVuln.rawScore,
    vulnerabilitySampleWeight: homeVuln.sampleWeight,
    vulnerabilityTrueInnings: homeVuln.trueInnings,
    stats: homeVuln.stats,
    available: homeVuln.available,
    status: homeVuln.status
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
  vulnerabilityModel: {
    source: "MLB Stats API live season pitching",
    scale: "0-100 risk index; not a probability",
    liveSlateMedian: Number(liveSlateMedian.toFixed(2)),
    fullSampleInnings: 60
  },
  count: finalGames.length,
  games: finalGames
});

writeJSON("pitcher_vulnerability.json", {
  updatedAt: new Date().toISOString(),
  date: slatePayload.date || "",
  source: "MLB Stats API live season pitching",
  scale: "0-100 risk index; not a probability",
  liveSlateMedian: Number(liveSlateMedian.toFixed(2)),
  fullSampleInnings: 60,
  count: pitcherRows.length,
  pitchers: pitcherRows
});

console.log("");
console.log("GAME PITCHER MATCHUPS COMPLETE");
console.log("Games:", finalGames.length);
console.log("Pitchers:", pitcherRows.length);
console.log("Saved: website/data/game_pitcher_matchups.json");
console.log("Saved: website/data/pitcher_vulnerability.json");
