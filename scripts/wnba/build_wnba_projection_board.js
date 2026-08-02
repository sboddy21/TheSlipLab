import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "website/data");
const GAMES_FILE = path.join(DATA, "wnba_games_today.json");
const PLAYERS_FILE = path.join(DATA, "wnba_player_baselines.json");
const TEAMS_FILE = path.join(DATA, "wnba_team_baselines.json");
const BOARD_FILE = path.join(DATA, "wnba_projection_board.json");
const HISTORY_FILE = path.join(DATA, "wnba_projection_history.json");
const CALIBRATION_FILE = path.join(DATA, "wnba_calibration.json");

const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const readOr = (file, fallback) => fs.existsSync(file) ? read(file) : fallback;
const round = value => Number(value.toFixed(1));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function latestActual(player, eventId) {
  return player.recent?.gameLog?.find(game => String(game.eventId) === String(eventId)) || null;
}

function gradeHistory(history, playersById) {
  for (const slate of history.slates || []) {
    if (slate.status === "graded" || slate.date > todayET()) continue;
    let graded = 0;
    for (const projection of slate.projections || []) {
      const player = playersById.get(String(projection.playerId));
      const actual = player ? latestActual(player, projection.gameId) : null;
      if (!actual) continue;
      projection.actual = { points: actual.points, rebounds: actual.rebounds, assists: actual.assists, threes: actual.threes, minutes: actual.minutes };
      projection.errors = Object.fromEntries(["points", "rebounds", "assists", "threes"].map(market => [market, round(Math.abs(projection.projections[market].value - actual[market]))]));
      graded++;
    }
    slate.gradedCount = graded;
    slate.status = graded === (slate.projections?.length || 0) && graded > 0 ? "graded" : "partial";
    slate.gradedAt = new Date().toISOString();
  }
  return history;
}

function calibration(history) {
  const graded = (history.slates || []).flatMap(slate => slate.projections || []).filter(row => row.actual);
  const markets = {};
  const targets = { points: 5.5, rebounds: 2.5, assists: 2.0, threes: 1.1 };
  for (const market of Object.keys(targets)) {
    const errors = graded.map(row => row.errors[market]);
    markets[market] = {
      samples: errors.length,
      mae: errors.length ? round(errors.reduce((sum, value) => sum + value, 0) / errors.length) : null,
      targetMae: targets[market],
      passing: errors.length >= 150 && errors.reduce((sum, value) => sum + value, 0) / errors.length <= targets[market]
    };
  }
  const verified = Object.values(markets).every(market => market.passing);
  return {
    sport: "WNBA", mode: "shadow", generatedAt: new Date().toISOString(), gradedProjections: graded.length,
    minimumSamples: 150, markets, verified, releaseStatus: verified ? "eligible_for_review" : "collecting",
    notes: ["MAE is measured against frozen pregame projections.", "Passing thresholds make the board eligible for review; they do not automatically publish betting recommendations."]
  };
}

function marketProjection(player, expectedMinutes, paceFactor, defenseFactor, market) {
  const season = player.season[market === "threes" ? "threesMade" : market];
  const recent = market === "threes" ? season : (player.recent?.[market] ?? season);
  const seasonRate = player.season.minutes ? season / player.season.minutes : 0;
  const recentMinutes = player.recent?.minutes || player.season.minutes;
  const recentRate = recentMinutes ? recent / recentMinutes : seasonRate;
  const rate = seasonRate * .65 + recentRate * .35;
  const adjustment = paceFactor * (market === "points" ? defenseFactor : 1);
  const value = Math.max(0, rate * expectedMinutes * adjustment);
  const spread = market === "points" ? 5.5 : market === "rebounds" ? 2.7 : market === "assists" ? 2.1 : 1.2;
  return { value: round(value), floor: round(Math.max(0, value - spread)), ceiling: round(value + spread) };
}

function main() {
  const gamesData = read(GAMES_FILE);
  const playersData = read(PLAYERS_FILE);
  const teamsData = read(TEAMS_FILE);
  const playersById = new Map(playersData.players.map(player => [String(player.playerId), player]));
  const teamsByAbbreviation = new Map(teamsData.teams.map(team => [team.abbreviation, team]));
  let history = gradeHistory(readOr(HISTORY_FILE, { sport: "WNBA", version: 1, slates: [] }), playersById);
  const now = Date.now();
  const leaguePace = teamsData.teams.reduce((sum, team) => sum + team.environment.estimatedPace, 0) / teamsData.teams.length;
  const leagueDefense = teamsData.teams.reduce((sum, team) => sum + team.environment.pointsAgainst, 0) / teamsData.teams.length;
  const projections = [];
  const excludedGames = [];

  for (const game of gamesData.games || []) {
    const gameTime = Date.parse(game.gameTimeUTC);
    if (game.state !== "pre" || !Number.isFinite(gameTime) || now >= gameTime) {
      excludedGames.push({ gameId: game.gameId, reason: "Projection window closed before snapshot" });
      continue;
    }
    for (const [team, opponent] of [[game.awayTeam, game.homeTeam], [game.homeTeam, game.awayTeam]]) {
      const teamEnvironment = teamsByAbbreviation.get(team.abbreviation)?.environment;
      const opponentEnvironment = teamsByAbbreviation.get(opponent.abbreviation)?.environment;
      if (!teamEnvironment || !opponentEnvironment) continue;
      const paceFactor = clamp(((teamEnvironment.estimatedPace + opponentEnvironment.estimatedPace) / 2) / leaguePace, .92, 1.08);
      const defenseFactor = clamp(opponentEnvironment.pointsAgainst / leagueDefense, .92, 1.08);
      const candidates = playersData.players.filter(player => player.teamAbbreviation === team.abbreviation && player.season.minutes >= 15 && !/out|doubtful/i.test(player.injury?.status || ""));
      for (const player of candidates) {
        const expectedMinutes = round(clamp(player.season.minutes * .55 + (player.recent?.minutes || player.season.minutes) * .45, 10, 40));
        const projected = Object.fromEntries(["points", "rebounds", "assists", "threes"].map(market => [market, marketProjection(player, expectedMinutes, paceFactor, defenseFactor, market)]));
        const confidence = clamp(Math.round(45 + Math.min(25, player.season.games) + (player.recent?.games || 0) * 3 - (player.injury ? 15 : 0)), 40, 85);
        projections.push({
          gameId: game.gameId, gameTimeUTC: game.gameTimeUTC, playerId: player.playerId, player: player.player,
          team: team.abbreviation, opponent: opponent.abbreviation, expectedMinutes, confidence,
          role: player.role, roleScore: player.roleScore, injury: player.injury, projections: projected,
          context: { paceFactor: round(paceFactor), opponentDefenseFactor: round(defenseFactor), opponentDefenseRank: opponentEnvironment.defenseRank }
        });
      }
    }
  }

  projections.sort((a, b) => b.confidence - a.confidence || b.roleScore - a.roleScore || a.player.localeCompare(b.player));
  const snapshot = {
    sport: "WNBA", date: gamesData.date, mode: "shadow", generatedAt: new Date().toISOString(), frozenPregame: true,
    source: "WNBA independent baselines plus today’s schedule and opponent environment", count: projections.length,
    excludedGames, projections,
    disclaimer: "Experimental shadow projections for calibration. Not verified recommendations, sportsbook odds, or guarantees."
  };

  const existingIndex = history.slates.findIndex(slate => slate.date === snapshot.date);
  if (existingIndex < 0 && projections.length) history.slates.push({ date: snapshot.date, createdAt: snapshot.generatedAt, status: "pending", projections: structuredClone(projections) });
  const frozenSlate = existingIndex >= 0 ? history.slates[existingIndex] : history.slates.find(slate => slate.date === snapshot.date);
  if (frozenSlate) {
    snapshot.projections = structuredClone(frozenSlate.projections || []);
    snapshot.count = snapshot.projections.length;
    snapshot.frozenAt = frozenSlate.createdAt;
  }
  history.slates.sort((a, b) => a.date.localeCompare(b.date));
  history.updatedAt = new Date().toISOString();
  const calibrationOutput = calibration(history);
  fs.writeFileSync(BOARD_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(HISTORY_FILE, `${JSON.stringify(history, null, 2)}\n`);
  fs.writeFileSync(CALIBRATION_FILE, `${JSON.stringify(calibrationOutput, null, 2)}\n`);
  console.log(`WNBA PROJECTION BOARD COMPLETE: ${projections.length} shadow projections, ${excludedGames.length} excluded games`);
  console.log(`Calibration: ${calibrationOutput.gradedProjections} graded, status ${calibrationOutput.releaseStatus}`);
}

try { main(); } catch (error) { console.error("WNBA PROJECTION BOARD FAILED"); console.error(error); process.exit(1); }
