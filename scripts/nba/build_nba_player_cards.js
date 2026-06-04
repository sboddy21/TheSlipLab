import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const CORE_FILE = path.join(ROOT, "website/data/nba_core.json");
const POINTS_FILE = path.join(ROOT, "website/data/nba_points.json");
const MATCHUP_FILE = path.join(ROOT, "website/data/nba_matchup_engine.json");
const OUT = path.join(ROOT, "website/data/nba_player_cards.json");

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

function lastGames(core) {
  const games = Array.isArray(core.history?.recentGames) ? core.history.recentGames : [];
  return games.slice(0, 10).map(g => ({
    gameId: g.gameId,
    date: g.gameDate,
    matchup: g.matchup,
    minutes: round1(g.minutes),
    points: round1(g.points),
    rebounds: round1(g.rebounds),
    assists: round1(g.assists),
    threesMade: round1(g.threesMade),
    fieldGoalAttempts: round1(g.fieldGoalAttempts),
    freeThrowAttempts: round1(g.freeThrowAttempts)
  }));
}

function buildCard(core, points, matchup) {
  const tags = [
    ...(Array.isArray(points?.tags) ? points.tags : []),
    ...(Array.isArray(matchup?.tags) ? matchup.tags : [])
  ].filter(Boolean);

  return {
    playerId: core.playerId,
    player: core.player,
    nameShort: core.nameShort,
    jersey: core.jersey,
    position: core.position,
    status: core.status,
    starter: Boolean(core.starter),
    team: core.teamAbbr || core.team,
    teamName: core.team,
    opponent: core.opponentAbbr || core.opponent,
    opponentName: core.opponent,
    homeAway: core.homeAway,
    gameId: core.gameId,
    gameTimeUTC: core.gameTimeUTC,
    gameStatusText: core.gameStatusText,

    headline: {
      pointsScore: round1(points?.pointsScore),
      confidence: points?.confidence || "",
      pointsLean: round1(points?.pointsLean),
      matchupScore: round1(matchup?.matchupScore),
      matchupTier: matchup?.matchupTier || "",
      scoringRole: points?.scoringRole || "",
      minutesRole: points?.minutesRole || ""
    },

    production: {
      seasonPoints: round1(points?.seasonPoints ?? core.history?.season?.points),
      last5Points: round1(points?.last5Points ?? core.history?.last5?.points),
      last10Points: round1(points?.last10Points ?? core.history?.last10?.points),
      trendDiff: round1(points?.trendDiff),
      seasonRebounds: round1(core.history?.season?.rebounds),
      last5Rebounds: round1(core.history?.last5?.rebounds),
      seasonAssists: round1(core.history?.season?.assists),
      last5Assists: round1(core.history?.last5?.assists),
      seasonThrees: round1(core.history?.season?.threesMade),
      last5Threes: round1(core.history?.last5?.threesMade)
    },

    minutes: {
      expected: round1(points?.expectedMinutes),
      confidence: round1(points?.minutesConfidence),
      role: points?.minutesRole || "",
      season: round1(points?.seasonMinutes),
      last5: round1(points?.last5Minutes),
      last10: round1(points?.last10Minutes),
      trend: round1(points?.minutesTrend)
    },

    usage: {
      score: round1(points?.usageScore),
      tier: points?.usageTier || "",
      trend: points?.usageTrend || "",
      seasonFGA: round1(points?.seasonFGA),
      last5FGA: round1(points?.last5FGA),
      fgaTrend: round1(points?.fgaTrend),
      seasonFTA: round1(points?.seasonFTA),
      last5FTA: round1(points?.last5FTA),
      ftaTrend: round1(points?.ftaTrend),
      volumeTrend: round1(points?.volumeTrend),
      assistTrend: round1(points?.assistTrend)
    },

    matchup: {
      matchup: matchup?.matchup || `${core.teamAbbr} vs ${core.opponentAbbr}`,
      homeAway: core.homeAway,
      opponentContext: matchup?.opponentContext || "",
      paceContext: matchup?.paceContext || "",
      matchupScore: round1(matchup?.matchupScore),
      matchupTier: matchup?.matchupTier || ""
    },

    recentGames: lastGames(core),
    tags: [...new Set(tags)].slice(0, 12)
  };
}

async function main() {
  const core = readJSON(CORE_FILE, { players: [] });
  const points = readJSON(POINTS_FILE, { players: [] });
  const matchups = readJSON(MATCHUP_FILE, { players: [] });

  const coreRows = Array.isArray(core.players) ? core.players : [];
  const pointsMap = byId(points.players);
  const matchupMap = byId(matchups.players);

  const players = coreRows
    .map(c => buildCard(c, pointsMap.get(String(c.playerId)) || {}, matchupMap.get(String(c.playerId)) || {}))
    .sort((a, b) =>
      num(b.headline.pointsScore) - num(a.headline.pointsScore) ||
      String(a.player).localeCompare(String(b.player))
    );

  const out = {
    sport: "NBA",
    version: "1.0",
    source: "nba_core plus nba_points plus nba_matchup_engine",
    fetchedAt: new Date().toISOString(),
    date: core.date || points.date || "",
    season: core.season || points.season || "",
    playerCount: players.length,
    modelNotes: [
      "NBA Player Cards 1.0 combines core, points, matchup, minutes, usage, production, and recent game logs.",
      "No odds or betting lines are used."
    ],
    players
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA PLAYER CARDS COMPLETE");
  console.log("Players:", players.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA PLAYER CARDS FAILED");
  console.error(err);
  process.exit(1);
});
