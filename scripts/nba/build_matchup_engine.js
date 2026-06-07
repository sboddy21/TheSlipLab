import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const POINTS_FILE = path.join(ROOT, "website/data/nba_points.json");
const GAMES_FILE = path.join(ROOT, "website/data/nba_games_today.json");
const DEFENSE_FILE = path.join(ROOT, "website/data/nba_team_defense.json");
const PACE_FILE = path.join(ROOT, "website/data/nba_pace_engine.json");
const DEFENDER_FILE = path.join(ROOT, "website/data/nba_defender_engine.json");
const OUT = path.join(ROOT, "website/data/nba_matchup_engine.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    return null;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(v) {
  return Math.round(num(v) * 10) / 10;
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num(v)));
}

function matchupTier(score) {
  if (score >= 85) return "Elite Matchup";
  if (score >= 75) return "Strong Matchup";
  if (score >= 62) return "Playable Matchup";
  if (score >= 50) return "Neutral Matchup";
  return "Thin Matchup";
}

function findGame(row, games) {
  return games.find(g =>
    String(g.gameId) === String(row.gameId) ||
    (
      (
        String(g.homeTeam?.abbreviation || "") === String(row.team) ||
        String(g.awayTeam?.abbreviation || "") === String(row.team)
      ) &&
      (
        String(g.homeTeam?.abbreviation || "") === String(row.opponent) ||
        String(g.awayTeam?.abbreviation || "") === String(row.opponent)
      )
    )
  ) || null;
}

function topDefenders(defenderMap, opponent) {
  const rows = defenderMap.get(String(opponent || "")) || [];
  return rows.slice(0, 3).map(d => ({
    player: d.player,
    position: d.position,
    defendedFGA: d.defendedFGA,
    pctPlusMinus: d.pctPlusMinus,
    tier: d.defenderTier
  }));
}

function defenderContext(defenders) {
  if (!Array.isArray(defenders) || !defenders.length) return "No defender tracking context";
  return defenders.map(d => `${d.player}: ${d.tier}, ${d.pctPlusMinus}`).join(" | ");
}

function defenderTags(defenders) {
  const tags = [];
  if (!Array.isArray(defenders)) return tags;

  if (defenders.some(d => d.tier === "Elite Defender")) tags.push("Elite Defender In Matchup");
  if (defenders.some(d => d.tier === "Strong Defender")) tags.push("Strong Defender In Matchup");
  if (defenders.some(d => d.tier === "Attackable Defender")) tags.push("Attackable Defender In Matchup");

  return tags;
}

function paceBoost(pace) {
  if (!pace) return 0;
  const rank = num(pace.rankPace);
  if (rank <= 5) return 5;
  if (rank <= 10) return 3;
  if (rank >= 26) return -4;
  if (rank >= 21) return -2;
  return 0;
}

function defenseBoost(defense) {
  if (!defense) return 0;
  const rank = num(defense.rankPointsAllowed);
  if (rank >= 26) return 8;
  if (rank >= 21) return 5;
  if (rank >= 16) return 2;
  if (rank <= 5) return -6;
  if (rank <= 10) return -3;
  return 0;
}


function defenderBoost(defenders) {
  if (!Array.isArray(defenders) || !defenders.length) return 0;

  let score = 0;

  for (const d of defenders) {
    if (d.tier === "Elite Defender") score -= 3;
    else if (d.tier === "Strong Defender") score -= 2;
    else if (d.tier === "Positive Defender") score -= 1;
    else if (d.tier === "Attackable Defender") score += 2;
  }

  return score;
}

function buildScore(row, defense, pace, defenders) {
  const pointsScore = num(row.pointsScore);
  const usageScore = num(row.usageScore);
  const minutes = num(row.expectedMinutes);
  const minutesConfidence = num(row.minutesConfidence);
  const volumeTrend = num(row.volumeTrend);
  const trendDiff = num(row.trendDiff);

  const base = clamp(pointsScore * 0.34, 0, 34);
  const usage = clamp((usageScore / 100) * 20, 0, 20);
  const mins = clamp((minutes / 36) * 16, 0, 16);
  const minConf = clamp((minutesConfidence / 100) * 8, 0, 8);
  const volume = clamp((volumeTrend / 8) * 8, -4, 8);
  const scoringTrend = clamp((trendDiff / 8) * 6, -4, 6);

  const homeAwayBoost = row.homeAway === "HOME" ? 2 : 0;
  const usageSpikeBoost = row.usageTrend === "Usage Spike" ? 4 : row.usageTrend === "Usage Up" ? 2 : 0;
  const roleBoost =
    row.scoringRole === "Primary Scorer" ? 4 :
    row.scoringRole === "Strong Scorer" ? 2 :
    0;

  const matchupScore = clamp(
    base +
    usage +
    mins +
    minConf +
    volume +
    scoringTrend +
    homeAwayBoost +
    usageSpikeBoost +
    roleBoost +
    defenseBoost(defense) +
    paceBoost(pace) +
    defenderBoost(defenders)
  );

  return round1(matchupScore);
}

function buildRow(row, games, defenseMap, paceMap, defenderMap) {
  const game = findGame(row, games);
  const defense = defenseMap.get(String(row.opponent)) || null;
  const pace = paceMap.get(String(row.opponent)) || null;
  const defenders = topDefenders(defenderMap, row.opponent);
  const matchupScore = buildScore(row, defense, pace, defenders);
  const tier = matchupTier(matchupScore);

  const tags = [
    tier,
    row.homeAway === "HOME" ? "Home Spot" : "Road Spot",
    defense?.defensiveTier || "",
    pace?.paceTier || "",
    pace && num(pace.rankPace) <= 10 ? "Pace Boost" : "",
    pace && num(pace.rankPace) >= 21 ? "Slow Pace" : "",
    ...defenderTags(defenders),
    defense && num(defense.rankPointsAllowed) >= 21 ? "Defense Target" : "",
    defense && num(defense.rankPointsAllowed) <= 10 ? "Tough Points Defense" : "",
    row.usageTrend === "Usage Spike" ? "Usage Spike" : "",
    row.usageTrend === "Usage Up" ? "Usage Up" : "",
    num(row.volumeTrend) >= 5 ? "Volume Acceleration" : "",
    num(row.expectedMinutes) >= 32 ? "Minute Edge" : "",
    row.scoringRole || "",
    row.minutesRole || ""
  ].filter(Boolean);

  return {
    playerId: row.playerId,
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    position: row.position,
    homeAway: row.homeAway,
    gameId: row.gameId,
    gameTimeUTC: row.gameTimeUTC,
    gameStatusText: row.gameStatusText,

    matchup: `${row.team} vs ${row.opponent}`,
    arena: game?.arena || "",
    city: game?.city || "",
    opponentContext: defense ? `${defense.teamAbbr} allows ${defense.pointsAllowed} PPG, rank ${defense.rankPointsAllowed} vs points` : "Neutral until team defense dataset is added",
    paceContext: pace ? `${pace.teamAbbr} pace ${pace.pace}, rank ${pace.rankPace}` : "Neutral until pace dataset is added",
    defenderContext: defenderContext(defenders),
    topDefenders: defenders,
    pace: pace ? {
      opponent: pace.teamAbbr,
      pace: pace.pace,
      rankPace: pace.rankPace,
      paceTier: pace.paceTier,
      offensiveRating: pace.offensiveRating,
      defensiveRating: pace.defensiveRating,
      netRating: pace.netRating
    } : null,
    defense: defense ? {
      opponent: defense.teamAbbr,
      defensiveTier: defense.defensiveTier,
      pointsAllowed: defense.pointsAllowed,
      rankPointsAllowed: defense.rankPointsAllowed,
      reboundsAllowed: defense.reboundsAllowed,
      rankReboundsAllowed: defense.rankReboundsAllowed,
      assistsAllowed: defense.assistsAllowed,
      rankAssistsAllowed: defense.rankAssistsAllowed,
      threesAllowed: defense.threesAllowed,
      rankThreesAllowed: defense.rankThreesAllowed
    } : null,

    pointsScore: round1(row.pointsScore),
    pointsLean: round1(row.pointsLean),
    usageScore: round1(row.usageScore),
    usageTrend: row.usageTrend,
    volumeTrend: round1(row.volumeTrend),
    expectedMinutes: round1(row.expectedMinutes),
    minutesConfidence: round1(row.minutesConfidence),
    minutesRole: row.minutesRole,
    scoringRole: row.scoringRole,

    matchupScore,
    matchupTier: tier,
    tags: [...new Set(tags)].slice(0, 12)
  };
}

async function main() {
  const points = readJSON(POINTS_FILE, { players: [] });
  const gamesPayload = readJSON(GAMES_FILE, { games: [] });
  const defensePayload = readJSON(DEFENSE_FILE, { teams: [] });
  const pacePayload = readJSON(PACE_FILE, { teams: [] });
  const defenderPayload = readJSON(DEFENDER_FILE, { byTeam: {} });

  const players = Array.isArray(points.players) ? points.players : [];
  const games = Array.isArray(gamesPayload.games) ? gamesPayload.games : [];
  const defenses = Array.isArray(defensePayload.teams) ? defensePayload.teams : [];
  const paces = Array.isArray(pacePayload.teams) ? pacePayload.teams : [];
  const defendersByTeam = defenderPayload.byTeam || {};

  const defenseMap = new Map();
  for (const team of defenses) {
    if (team.teamAbbr) defenseMap.set(String(team.teamAbbr), team);
  }

  const paceMap = new Map();
  for (const team of paces) {
    if (team.teamAbbr) paceMap.set(String(team.teamAbbr), team);
  }

  const defenderMap = new Map();
  for (const [team, rows] of Object.entries(defendersByTeam)) {
    defenderMap.set(String(team), Array.isArray(rows) ? rows : []);
  }

  const rows = players
    .filter(p => String(p.status || "").toUpperCase() === "ACTIVE")
    .map(p => buildRow(p, games, defenseMap, paceMap, defenderMap))
    .sort((a, b) =>
      b.matchupScore - a.matchupScore ||
      b.pointsScore - a.pointsScore ||
      b.usageScore - a.usageScore ||
      String(a.player).localeCompare(String(b.player))
    )
    .map((row, index) => ({
      rank: index + 1,
      ...row
    }));

  const out = {
    sport: "NBA",
    version: "3.0",
    source: "nba_points plus nba_games_today",
    fetchedAt: new Date().toISOString(),
    date: points.date || gamesPayload.date || "",
    season: points.season || "",
    playerCount: rows.length,
    modelNotes: [
      "NBA Matchup Engine 2.1 uses points board context, real NBA team defense allowed data, and real NBA pace data.",
      "Opponent defensive ranks are pulled from nba_team_defense.json.",
      "Pace ranks are pulled from nba_pace_engine.json.",
      "Top opponent defender context is pulled from nba_defender_engine.json.",
      "Matchup Engine 3.0 applies a small defender pressure adjustment to the matchup score.",
      "No odds or betting lines are used."
    ],
    players: rows
  };

  const existing = readExisting();
const existingPlayers = Array.isArray(existing?.players) ? existing.players : [];

if (rows.length === 0 && existingPlayers.length > 0) {
  fs.writeFileSync(OUT, JSON.stringify({
    ...existing,
    preservedAt: new Date().toISOString(),
    preserveReason: "Matchup engine generated 0 players"
  }, null, 2));

  console.log("MATCHUP ENGINE PRESERVED PREVIOUS DATA");
  return;
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA MATCHUP ENGINE COMPLETE");
  console.log("Players:", rows.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA MATCHUP ENGINE FAILED");
  console.error(err);
  process.exit(1);
});
