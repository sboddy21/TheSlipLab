import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../website/data");
const files = ["nfl_teams.json", "nfl_schedule.json", "nfl_games_today.json", "nfl_player_pool.json", "nfl_depth_charts.json", "nfl_injuries.json", "nfl_usage_baselines.json", "nfl_preseason_usage.json", "nfl_preseason_audit.json", "nfl_preseason_role_board.json", "nfl_role_engine.json", "nfl_matchup_context.json", "nfl_practice_reports.json", "nfl_weather.json", "nfl_receiving_yards_board.json", "nfl_results_tracking.json", "nfl_td_decision_center.json", "nfl_data_health.json", "nfl_public_status.json"];

function fail(message) {
  throw new Error(`NFL VALIDATION FAILED: ${message}`);
}

function read(filename) {
  const fullPath = path.join(DATA, filename);
  if (!fs.existsSync(fullPath)) fail(`${filename} is missing`);
  const payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  if (payload.sport !== "NFL" || payload.schemaVersion !== "1.0") fail(`${filename} has invalid identity metadata`);
  if (!Number.isFinite(Date.parse(payload.generatedAt))) fail(`${filename} has invalid generatedAt`);
  return payload;
}

const payloads = Object.fromEntries(files.map(file => [file, read(file)]));
const teams = payloads["nfl_teams.json"];
const schedule = payloads["nfl_schedule.json"];
const pool = payloads["nfl_player_pool.json"];
const depth = payloads["nfl_depth_charts.json"];
const injuries = payloads["nfl_injuries.json"];
const usage = payloads["nfl_usage_baselines.json"];
const preseason = payloads["nfl_preseason_usage.json"];
const preseasonAudit = payloads["nfl_preseason_audit.json"];
const preseasonBoard = payloads["nfl_preseason_role_board.json"];
const roles = payloads["nfl_role_engine.json"];
const matchup = payloads["nfl_matchup_context.json"];
const practice = payloads["nfl_practice_reports.json"];
const weather = payloads["nfl_weather.json"];
const receiving = payloads["nfl_receiving_yards_board.json"];
const results = payloads["nfl_results_tracking.json"];
const tdBoard = payloads["nfl_td_decision_center.json"];
const health = payloads["nfl_data_health.json"];
const publicStatus = payloads["nfl_public_status.json"];
const foundation = JSON.parse(fs.readFileSync(path.join(DATA, "nfl_foundation.json"), "utf8"));

if (teams.teamCount !== 32 || teams.teams?.length !== 32) fail("team contract must contain 32 teams");
if (new Set(teams.teams.map(team => team.teamId)).size !== 32) fail("team IDs must be unique");
if (schedule.gameCount < 272 || schedule.games?.length !== schedule.gameCount) fail("regular-season schedule is incomplete");
if (schedule.games.some(game => game.seasonType !== 2 || !game.gameId || !game.kickoffUTC)) fail("schedule contains an invalid game");
if (new Set(schedule.games.map(game => game.gameId)).size !== schedule.gameCount) fail("game IDs must be unique");
if (!pool.playerCount || pool.players?.length !== pool.playerCount) fail("player pool is empty or inconsistent");
if (pool.players.some(player => !["QB", "RB", "WR", "TE"].includes(player.position))) fail("player pool contains an ineligible position");
if (new Set(pool.players.map(player => player.playerId)).size !== pool.playerCount) fail("player IDs must be unique");
if (depth.availability !== "available" || depth.teamCount !== 32 || !depth.entryCount) fail("depth-chart contract is incomplete");
if (depth.entries.some(entry => !entry.playerId || !entry.team || !entry.position || !Number.isFinite(entry.rank))) fail("depth-chart contract contains an invalid entry");
if (injuries.availability !== "partial" || !Array.isArray(injuries.injuries)) fail("injury contract must explicitly report partial preseason coverage");
if (usage.profileCount < 400 || usage.sourcePlayCount < 100000 || usage.profiles?.length !== usage.profileCount) fail("historical usage contract is incomplete");
if (usage.methodology?.routes !== "Unavailable from play-by-play and intentionally not estimated.") fail("usage contract must explicitly reject inferred routes");
if (usage.profiles.some(profile => !profile.playerId || !profile.gsisId || !profile.weightedPerGame)) fail("usage contract contains an invalid profile");
if (!preseason.finalGameGate || preseason.processedGameCount !== preseason.completedGameCount || preseason.failures?.length) fail("preseason usage must process every completed game behind the final-game gate");
if (preseason.players.some(player => !player.playerId || !player.latestGame?.gameId || !["initial_sample", "rising", "stable", "falling"].includes(player.roleSignal))) fail("preseason usage contains an invalid player profile");
if (preseasonAudit.status !== "passed" || preseasonAudit.criticalIssues?.length) fail("preseason audit did not pass");
if (!preseasonBoard.finalGameGate || preseasonBoard.projectionStatus !== "disabled" || preseasonBoard.rows?.length !== preseasonBoard.counts?.rows) fail("private preseason role board is invalid");
if (preseasonBoard.rows.some(row => ["rising", "falling", "stable"].includes(row.roleSignal) && row.games < 2)) fail("movement signal published without two samples");
if (roles.status !== "role_estimation_only" || roles.playerCount !== pool.playerCount || roles.roles?.length !== roles.playerCount) fail("role engine is incomplete");
if (roles.roles.some(role => role.projectionStatus !== "disabled_pending_preseason_usage_and_market_lines")) fail("role engine must keep projections disabled");
if (roles.roles.some(role => role.confidence?.score > roles.methodology?.confidenceCeiling)) fail("role confidence exceeds the missing-preseason ceiling");
if (matchup.status !== "private_week_matchup_context" || matchup.contextType !== "historical_baseline_without_live_weather") fail("matchup context identity is invalid");
if (matchup.counts?.games !== 16 || matchup.counts?.teamContexts !== 32 || matchup.counts?.playerAssignments !== pool.playerCount || matchup.counts?.duplicatePlayerAssignments !== 0 || matchup.counts?.missingTeamAssignments !== 0) fail("matchup assignment counts are invalid");
if (new Set(matchup.playerAssignments.map(row => row.playerId)).size !== pool.playerCount) fail("players must have exactly one matchup assignment");
const matchupGames = new Map(matchup.games.map(game => [game.gameId, game]));
if (matchup.playerAssignments.some(row => { const game = matchupGames.get(row.gameId); return !game || ![game.homeTeam, game.awayTeam].includes(row.team) || ![game.homeTeam, game.awayTeam].includes(row.opponent) || row.team === row.opponent; })) fail("a player has an invalid game or opponent assignment");
if (matchup.teamContexts.some(row => !row.opponent || !Number.isFinite(row.scoringEnvironment?.projectedTeamTouchdownsBaseline) || !Number.isFinite(row.scoringEnvironment?.paceIndex))) fail("matchup context contains invalid scoring data");
if (matchup.teamContexts.some(row => !["available_with_position_coverage", "partial_position_coverage"].includes(row.opponentDefense?.status) || Object.values(row.opponentDefense?.vulnerabilityPercentileByPosition || {}).some(value => !Number.isFinite(value)))) fail("defensive vulnerability context is incomplete");
if (!Number.isFinite(Date.parse(matchup.historicalBuiltAt)) || matchup.freshness?.historicalAgeHours > 30) fail("historical matchup cache is stale");
if (practice.players?.length !== pool.playerCount || practice.freshnessPolicy?.absenceMeansHealthy !== false) fail("practice-report contract is incomplete or unsafe");
if (practice.players.some(row => row.regularSeasonRoleConfirmed && (!practice.officialReportsActive || !row.roleEligible || !row.activeRosterGate))) fail("role confirmation bypassed practice or availability gates");
if (weather.games?.length !== 16 || weather.freshnessPolicy?.staleForecastsAccepted !== false || weather.games.some(row => row.weatherGate && !["indoor_verified", "forecast_available"].includes(row.status))) fail("weather contract is incomplete or stale-open");
if (receiving.status !== "private_shadow_board" || receiving.recommendationStatus !== "disabled" || receiving.counts?.publishableRecommendations !== 0 || !receiving.rows?.length) fail("receiving-yards shadow board is invalid");
if (receiving.rows.some(row => row.publicationStatus !== "private_shadow_only" || row.scoreType !== "private_shadow_signal_not_yardage_projection")) fail("receiving-yards board published a projection");
if (results.methodology?.snapshotRequiredBeforeKickoff !== true || results.methodology?.retroactiveSelectionsForbidden !== true) fail("results tracking lacks anti-leakage rules");
if (tdBoard.status !== "private_shadow_board" || tdBoard.market !== "anytime_touchdown" || tdBoard.recommendationStatus !== "disabled" || tdBoard.projectionStatus !== "disabled") fail("TD Decision Center must remain private and gated");
if (!tdBoard.rows?.length || tdBoard.rows.length !== tdBoard.counts?.rankedPlayers || tdBoard.counts?.publishableRecommendations !== 0) fail("TD Decision Center counts are invalid");
if (new Set(tdBoard.rows.map(row => row.playerId)).size !== tdBoard.rows.length || tdBoard.rows.some((row, index) => row.shadowRank !== index + 1)) fail("TD Decision Center identity or rank order is invalid");
if (tdBoard.rows.some(row => row.scoreType !== "private_shadow_signal_not_probability" || row.tdSignalScore < 0 || row.tdSignalScore > 100 || row.publicationStatus !== "private_shadow_only")) fail("TD Decision Center contains an invalid shadow score");
if (tdBoard.rows.some(row => row.gates?.regularSeasonRoleConfirmed && !practice.officialReportsActive)) fail("TD Decision Center bypassed a role gate");
const weatherByGame = new Map(weather.games.map(row => [row.gameId, row]));
if (tdBoard.rows.some(row => !row.opponent || !row.gameId || !row.gates?.verifiedOpponent || !row.gates?.defensiveMatchup || row.gates?.gameEnvironment !== (weatherByGame.get(row.gameId)?.weatherGate === true) || row.matchup?.status !== "verified_historical_baseline")) fail("TD Decision Center is missing verified matchup or weather context");
if (health.status !== "nfl_dress_rehearsal_private_gates_active" || health.sources?.depthCharts?.status !== "available") fail("health contract must report private dress-rehearsal readiness");
if (health.sources?.injuries?.status !== "partial" || health.sources?.projections?.status !== "disabled") fail("health contract must keep partial injuries and disabled projections explicit");
if (health.sources?.usageBaselines?.status !== "available" || health.sources?.routes?.status !== "unavailable") fail("health contract must distinguish usage baselines from unavailable routes");
if (health.sources?.roleEngine?.status !== "available" || !["available", "waiting"].includes(health.sources?.preseasonUsage?.status) || !health.sources?.preseasonUsage?.finalGameGate) fail("health contract must report final-gated preseason usage");
if (health.sources?.tdDecisionCenter?.status !== "private_shadow_only" || health.sources?.tdDecisionCenter?.publishableRecommendations !== 0) fail("health contract must keep the TD Decision Center private and gated");
if (health.sources?.matchupContext?.status !== "available_historical_baseline" || health.sources?.matchupContext?.teamContexts !== 32) fail("health contract must report complete matchup context");
if (!health.sources?.practiceReports || !health.sources?.weather || health.sources?.receivingYards?.publishableRecommendations !== 0) fail("health contract is missing dress-rehearsal sources");
if (publicStatus.weekOneGames?.length !== 16 || publicStatus.counts?.roleEligible !== roles.modelEligibleCount || publicStatus.counts?.completedPreseasonGames !== preseason.processedGameCount || !publicStatus.preseasonUsage?.finalGameGate) fail("public NFL status is incomplete");
if ("roles" in publicStatus || "players" in publicStatus || "injuries" in publicStatus) fail("public NFL status contains protected detail arrays");
if (foundation.currentPhase?.id === "foundation" && foundation.date >= "2026-08-21") fail("roadmap regressed to the completed foundation phase");
if (foundation.phases?.filter(phase => phase.status === "active").length > 1) fail("roadmap contains multiple active phases");
if (health.sources?.depthCharts?.status === "available" && foundation.nextBuildSteps?.some(step => /select.*depth-chart/i.test(step))) fail("roadmap contains a completed depth-chart task");

console.log(`NFL VALIDATION PASSED: ${teams.teamCount} teams, ${schedule.gameCount} games, ${pool.playerCount} eligible players, ${depth.entryCount} depth entries, ${injuries.injuryCount} injuries, ${usage.profileCount} usage profiles, ${roles.modelEligibleCount} role-eligible players`);
