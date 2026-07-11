import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");

const PLAYER_POOL_FILE = path.join(ROOT, "website/data/nba_player_pool.json");
const MINUTES_FILE = path.join(ROOT, "website/data/nba_minutes_engine.json");
const HISTORY_FILE = path.join(ROOT, "website/data/nba_history.json");
const USAGE_FILE = path.join(ROOT, "website/data/nba_usage_engine.json");
const OUT = path.join(ROOT, "website/data/nba_core.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(v) {
  return Math.round(num(v) * 10) / 10;
}

function byId(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.playerId) map.set(String(row.playerId), row);
  }
  return map;
}

function trendScore(last5, season) {
  const diff = num(last5) - num(season);
  if (diff >= 6) return 15;
  if (diff >= 4) return 12;
  if (diff >= 2) return 8;
  if (diff >= 1) return 4;
  if (diff <= -6) return -10;
  if (diff <= -4) return -7;
  if (diff <= -2) return -4;
  return 0;
}

function minutesSignal(expectedMinutes, confidence) {
  const min = num(expectedMinutes);
  const conf = num(confidence);

  let score = 0;

  if (min >= 36) score += 25;
  else if (min >= 33) score += 22;
  else if (min >= 30) score += 18;
  else if (min >= 26) score += 12;
  else if (min >= 20) score += 7;
  else score += 2;

  if (conf >= 90) score += 10;
  else if (conf >= 80) score += 7;
  else if (conf >= 70) score += 4;

  return score;
}

function volumeSignal(history) {
  const season = history?.seasonSummary || {};
  const last5 = history?.last5 || {};

  let score = 0;

  if (num(season.fieldGoalAttempts) >= 18) score += 18;
  else if (num(season.fieldGoalAttempts) >= 15) score += 14;
  else if (num(season.fieldGoalAttempts) >= 12) score += 10;
  else if (num(season.fieldGoalAttempts) >= 9) score += 6;

  if (num(last5.fieldGoalAttempts) > num(season.fieldGoalAttempts) + 2) score += 7;

  if (num(season.freeThrowAttempts) >= 6) score += 6;
  else if (num(season.freeThrowAttempts) >= 4) score += 4;

  return score;
}

function scoringProfile(history) {
  const season = history?.seasonSummary || {};
  const last5 = history?.last5 || {};
  const last10 = history?.last10 || {};

  return {
    seasonPoints: round1(season.points),
    last5Points: round1(last5.points),
    last10Points: round1(last10.points),
    seasonRebounds: round1(season.rebounds),
    last5Rebounds: round1(last5.rebounds),
    last10Rebounds: round1(last10.rebounds),
    seasonAssists: round1(season.assists),
    last5Assists: round1(last5.assists),
    last10Assists: round1(last10.assists),
    seasonThrees: round1(season.threesMade),
    last5Threes: round1(last5.threesMade),
    last10Threes: round1(last10.threesMade),
    seasonMinutes: round1(season.minutes),
    last5Minutes: round1(last5.minutes),
    last10Minutes: round1(last10.minutes),
    seasonFGA: round1(season.fieldGoalAttempts),
    last5FGA: round1(last5.fieldGoalAttempts),
    seasonFTA: round1(season.freeThrowAttempts),
    last5FTA: round1(last5.freeThrowAttempts)
  };
}

function buildScores(player, minutes, history, usage) {
  const profile = scoringProfile(history);

  const minSig = minutesSignal(minutes?.expectedMinutes, minutes?.minutesConfidence);
  const volSig = volumeSignal(history);
  const useSig = num(usage?.usageScore);

  const pointsTrend = trendScore(profile.last5Points, profile.seasonPoints);
  const reboundsTrend = trendScore(profile.last5Rebounds, profile.seasonRebounds);
  const assistsTrend = trendScore(profile.last5Assists, profile.seasonAssists);
  const threesTrend = trendScore(profile.last5Threes, profile.seasonThrees);

  const statusBoost = String(player.status || "").toUpperCase() === "ACTIVE" ? 8 : 0;
  const starterBoost = player.starter ? 12 : 0;

  const pointsScore =
    statusBoost +
    starterBoost +
    minSig +
    volSig +
    useSig * 0.45 +
    num(profile.seasonPoints) +
    pointsTrend;

  const reboundsScore =
    statusBoost +
    starterBoost +
    minSig +
    num(profile.seasonRebounds) * 2.5 +
    reboundsTrend;

  const assistsScore =
    statusBoost +
    starterBoost +
    minSig +
    num(profile.seasonAssists) * 3 +
    assistsTrend;

  const threesScore =
    statusBoost +
    starterBoost +
    minSig +
    num(profile.seasonThrees) * 8 +
    threesTrend;

  const nbaScore =
    pointsScore * 0.45 +
    reboundsScore * 0.18 +
    assistsScore * 0.18 +
    threesScore * 0.19;

  return {
    nbaScore: Math.round(nbaScore),
    pointsScore: Math.round(pointsScore),
    reboundsScore: Math.round(reboundsScore),
    assistsScore: Math.round(assistsScore),
    threesScore: Math.round(threesScore)
  };
}

function buildTags(player, minutes, history, usage, scores) {
  const tags = [];

  if (player.starter) tags.push("Starter");
  if (minutes?.role) tags.push(minutes.role);

  const season = history?.season || {};
  const last5 = history?.last5 || {};

  if (num(last5.points) >= num(season.points) + 4) tags.push("Points Trending Up");
  if (num(last5.rebounds) >= num(season.rebounds) + 3) tags.push("Rebounds Trending Up");
  if (num(last5.assists) >= num(season.assists) + 2) tags.push("Assists Trending Up");
  if (num(last5.threesMade) >= num(season.threesMade) + 1) tags.push("Threes Trending Up");
  if (usage?.usageTier) tags.push(usage.usageTier);
  if (usage?.usageTrend) tags.push(usage.usageTrend);
  if (scores.nbaScore >= 80) tags.push("Top NBA Spot");
  if (num(minutes?.expectedMinutes) >= 34) tags.push("Heavy Minutes");

  return [...new Set(tags)].slice(0, 6);
}

function buildCorePlayer(player, minutesMap, historyMap, usageMap) {
  const minutes = minutesMap.get(String(player.playerId)) || {};
  const history = historyMap.get(String(player.playerId)) || {};
  const usage = usageMap.get(String(player.playerId)) || {};

  const profile = scoringProfile(history);
  const scores = buildScores(player, minutes, history, usage);
  const tags = buildTags(player, minutes, history, usage, scores);

  return {
    playerId: player.playerId,
    player: player.player,
    firstName: player.firstName,
    lastName: player.lastName,
    nameShort: player.nameShort,
    jersey: player.jersey,
    position: player.position,
    status: player.status,
    starter: Boolean(player.starter),
    oncourt: Boolean(player.oncourt),
    played: Boolean(player.played),

    teamId: player.teamId,
    team: player.team,
    teamCity: player.teamCity,
    teamAbbr: player.teamAbbr,

    opponentTeamId: player.opponentTeamId,
    opponent: player.opponent,
    opponentCity: player.opponentCity,
    opponentAbbr: player.opponentAbbr,

    homeAway: player.homeAway,
    gameId: player.gameId,
    gameTimeUTC: player.gameTimeUTC,
    gameStatus: player.gameStatus,
    gameStatusText: player.gameStatusText,

    minutes: {
      expected: num(minutes.expectedMinutes),
      confidence: num(minutes.minutesConfidence),
      role: minutes.role || ""
    },

    usage: {
      score: num(usage.usageScore),
      tier: usage.usageTier || "",
      trend: usage.usageTrend || "",
      seasonFGA: num(usage.seasonFGA),
      last5FGA: num(usage.last5FGA),
      last10FGA: num(usage.last10FGA),
      seasonFTA: num(usage.seasonFTA),
      last5FTA: num(usage.last5FTA),
      last10FTA: num(usage.last10FTA)
    },

    history: {
      gamesPlayed: num(history.gamesPlayed),
      season: history.seasonSummary || {},
      last5: history.last5 || {},
      last10: history.last10 || {},
      recentGames: Array.isArray(history.recentGames) ? history.recentGames : []
    },

    profile,

    signals: {
      minutesSignal: minutesSignal(minutes.expectedMinutes, minutes.minutesConfidence),
      volumeSignal: volumeSignal(history),
      pointsTrendSignal: trendScore(profile.last5Points, profile.seasonPoints),
      reboundsTrendSignal: trendScore(profile.last5Rebounds, profile.seasonRebounds),
      assistsTrendSignal: trendScore(profile.last5Assists, profile.seasonAssists),
      threesTrendSignal: trendScore(profile.last5Threes, profile.seasonThrees),
      usageSignal: num(usage.usageScore),
      paceSignal: 0,
      matchupSignal: 0
    },

    projections: {
      pointsLean: round1((profile.seasonPoints + profile.last5Points + profile.last10Points) / 3),
      reboundsLean: round1((profile.seasonRebounds + profile.last5Rebounds + profile.last10Rebounds) / 3),
      assistsLean: round1((profile.seasonAssists + profile.last5Assists + profile.last10Assists) / 3),
      threesLean: round1((profile.seasonThrees + profile.last5Threes + profile.last10Threes) / 3)
    },

    scores,
    tags
  };
}

async function main() {
  const pool = readJSON(PLAYER_POOL_FILE, { players: [], teams: [] });
  const minutesData = readJSON(MINUTES_FILE, { players: [] });
  const historyData = readJSON(HISTORY_FILE, { players: [] });
  const usageData = readJSON(USAGE_FILE, { players: [] });

  const players = Array.isArray(pool.players) ? pool.players : [];
  const teams = Array.isArray(pool.teams) ? pool.teams : [];

  const minutesMap = byId(minutesData.players);
  const historyMap = byId(historyData.players);
  const usageMap = byId(usageData.players);

  const corePlayers = players
    .filter(p => p.player && p.playerId)
    .map(p => buildCorePlayer(p, minutesMap, historyMap, usageMap))
    .sort((a, b) => b.scores.nbaScore - a.scores.nbaScore || a.player.localeCompare(b.player));

  const out = {
    sport: "NBA",
    version: "3.0",
    source: "nba_player_pool plus nba_minutes_engine plus nba_history plus nba_usage_engine",
    fetchedAt: new Date().toISOString(),
    date: pool.date || "",
    season: historyData.season || "",
    gameCount: pool.gameCount || 0,
    teamCount: teams.length,
    playerCount: corePlayers.length,
    availability: Number(pool.gameCount || 0) > 0 ? "games_scheduled" : "no_games_scheduled",
    modelNotes: [
      "Core 3.0 merges player pool, minutes engine, history, and usage engine.",
      "Points, rebounds, assists, threes, decision center, and player cards should read from this file."
    ],
    teams,
    players: corePlayers
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA CORE V3 COMPLETE");
  console.log("Games:", out.gameCount);
  console.log("Teams:", out.teamCount);
  console.log("Players:", out.playerCount);
  console.log("Season:", out.season);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA CORE V2 FAILED");
  console.error(err);
  process.exit(1);
});
