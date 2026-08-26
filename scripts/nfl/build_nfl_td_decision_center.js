import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../website/data");
const read = filename => JSON.parse(fs.readFileSync(path.join(DATA, filename), "utf8"));
const write = (filename, payload) => fs.writeFileSync(path.join(DATA, filename), `${JSON.stringify(payload, null, 2)}\n`);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = value => Math.max(0, Math.min(100, number(value)));
const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
};

function opportunity(metrics = {}) {
  return {
    touchdowns: round(number(metrics.rushingTds) + number(metrics.receivingTds), 3),
    redZoneCarries: round(metrics.redZoneCarries, 3),
    inside10Carries: round(metrics.inside10Carries, 3),
    redZoneTargets: round(metrics.redZoneTargets, 3),
    inside10Targets: round(metrics.inside10Targets, 3)
  };
}

function scoreRow(role, assignment, context, practice, weather) {
  const baseline = opportunity(role.historicalOpportunity?.weightedPerGame);
  const recent = opportunity(role.historicalOpportunity?.recentSixGamesPerGame);
  const baselineHighValue = baseline.inside10Carries + baseline.inside10Targets;
  const recentHighValue = recent.inside10Carries + recent.inside10Targets;
  const baselineRedZone = baseline.redZoneCarries + baseline.redZoneTargets;
  const recentRedZone = recent.redZoneCarries + recent.redZoneTargets;
  const recentRatio = baselineRedZone > 0 ? recentRedZone / baselineRedZone : null;
  const goalLineScore = clamp(baseline.inside10Carries * 46 + baseline.inside10Targets * 38);
  const redZoneScore = clamp(baseline.redZoneCarries * 19 + baseline.redZoneTargets * 15);
  const touchdownHistoryScore = clamp(baseline.touchdowns * 115);
  const roleCertaintyScore = clamp(role.roleScore);
  const recentOpportunityScore = recentRatio === null ? 35 : clamp(50 + (recentRatio - 1) * 50);
  const baseTdSignalScore = round(
    goalLineScore * 0.32 +
    redZoneScore * 0.20 +
    touchdownHistoryScore * 0.20 +
    roleCertaintyScore * 0.23 +
    recentOpportunityScore * 0.05
  );
  const scoringEnvironmentScore = clamp(50 + ((context.scoringEnvironment.projectedTeamTouchdownsBaseline / context.scoringEnvironment.leagueTouchdownsPerGame) - 1) * 70);
  const defensiveVulnerabilityScore = clamp(context.opponentDefense.vulnerabilityPercentileByPosition[role.position]);
  const paceScore = clamp(50 + (context.scoringEnvironment.paceIndex - 100) * 2);
  const tdSignalScore = round(baseTdSignalScore * 0.80 + scoringEnvironmentScore * 0.12 + defensiveVulnerabilityScore * 0.06 + paceScore * 0.02);
  const dataConfidence = clamp(
    Math.min(40, number(role.historicalOpportunity?.games) * 1.5) +
    (role.depth ? 25 : 0) +
    (role.teamContext?.currentTeamContinuity ? 20 : 5) +
    (role.readiness?.status === "active_no_roster_injury" ? 15 : 5)
  );
  const trend = recentRatio === null ? "no_recent_comparison" : recentRatio >= 1.2 ? "opportunity_surge" : recentRatio <= 0.8 ? "opportunity_decline" : "stable";
  const strengths = [
    baseline.inside10Carries >= 0.8 ? `${baseline.inside10Carries} inside-10 carries/game` : "",
    baseline.inside10Targets >= 0.35 ? `${baseline.inside10Targets} inside-10 targets/game` : "",
    baseline.touchdowns >= 0.5 ? `${baseline.touchdowns} rush/receiving TDs/game` : "",
    recentRatio !== null && recentRatio >= 1.2 ? `${round((recentRatio - 1) * 100)}% recent red-zone opportunity increase` : "",
    role.depth?.rank === 1 ? "Current depth-chart starter" : "",
    defensiveVulnerabilityScore >= 70 ? `${assignment.opponent} defense is ${round(defensiveVulnerabilityScore)}th-percentile vulnerable to ${role.position} TDs` : "",
    scoringEnvironmentScore >= 60 ? `${context.scoringEnvironment.projectedTeamTouchdownsBaseline} team-TD historical baseline` : ""
  ].filter(Boolean);

  return {
    playerId: role.playerId,
    playerName: role.playerName,
    team: role.team,
    opponent: assignment.opponent,
    gameId: assignment.gameId,
    kickoffUTC: context.kickoffUTC,
    homeAway: assignment.homeAway,
    position: role.position,
    depthRank: role.depth?.rank || null,
    roleLabel: role.roleLabel,
    readiness: role.readiness?.status || "unknown",
    historicalGames: number(role.historicalOpportunity?.games),
    tdSignalScore,
    baseTdSignalScore,
    dataConfidence: round(dataConfidence),
    scoreType: "private_shadow_signal_not_probability",
    trend,
    historicalPerGame: baseline,
    recentSixPerGame: recent,
    components: {
      goalLineOpportunity: round(goalLineScore),
      redZoneOpportunity: round(redZoneScore),
      touchdownHistory: round(touchdownHistoryScore),
      roleCertainty: round(roleCertaintyScore),
      recentOpportunity: round(recentOpportunityScore),
      scoringEnvironment: round(scoringEnvironmentScore),
      defensiveVulnerability: round(defensiveVulnerabilityScore),
      pace: round(paceScore)
    },
    matchup: {
      status: "verified_historical_baseline",
      projectedTeamTouchdownsBaseline: context.scoringEnvironment.projectedTeamTouchdownsBaseline,
      leagueTouchdownsPerGame: context.scoringEnvironment.leagueTouchdownsPerGame,
      paceIndex: context.scoringEnvironment.paceIndex,
      defensiveVulnerabilityPercentile: defensiveVulnerabilityScore,
      opponentDefenseStatus: context.opponentDefense.status
    },
    strengths: strengths.length ? strengths : ["Role and historical opportunity context available"],
    gates: {
      activeRoster: role.readiness?.status !== "unavailable",
      currentTeamContinuity: Boolean(role.teamContext?.currentTeamContinuity),
      verifiedOpponent: true,
      routeParticipation: false,
      defensiveMatchup: true,
      gameEnvironment: Boolean(weather?.weatherGate),
      weather: Boolean(weather?.weatherGate),
      regularSeasonRoleConfirmed: practice?.regularSeasonRoleConfirmed === true
    },
    practiceReport: practice || null,
    weather: weather || null,
    publicationStatus: "private_shadow_only"
  };
}

function section(id, label, description, rows) {
  return { id, label, description, playerIds: rows.map(row => row.playerId) };
}

function main() {
  const roles = read("nfl_role_engine.json");
  const matchup = read("nfl_matchup_context.json");
  const practice = read("nfl_practice_reports.json");
  const weather = read("nfl_weather.json");
  const health = read("nfl_data_health.json");
  const generatedAt = new Date().toISOString();
  const assignmentByPlayer = new Map(matchup.playerAssignments.map(row => [row.playerId, row]));
  const contextByTeam = new Map(matchup.teamContexts.map(row => [row.team, row]));
  const practiceByPlayer = new Map(practice.players.map(row => [row.playerId, row]));
  const weatherByGame = new Map(weather.games.map(row => [row.gameId, row]));
  const eligible = roles.roles
    .filter(role => role.modelEligibility && role.historicalOpportunity && role.readiness?.status !== "unavailable")
    .map(role => {
      const assignment = assignmentByPlayer.get(role.playerId);
      const context = contextByTeam.get(role.team);
      if (!assignment || !context || assignment.team !== role.team) throw new Error(`Missing verified matchup context for ${role.playerName} (${role.team})`);
      return scoreRow(role, assignment, context, practiceByPlayer.get(role.playerId), weatherByGame.get(assignment.gameId));
    })
    .filter(row => row.position !== "QB" || row.historicalPerGame.redZoneCarries > 0)
    .sort((a, b) => b.tdSignalScore - a.tdSignalScore || b.dataConfidence - a.dataConfidence || a.playerName.localeCompare(b.playerName))
    .map((row, index) => ({ ...row, shadowRank: index + 1 }));

  const top = count => eligible.slice(0, count);
  const smash = eligible.filter(row => row.shadowRank <= 25 && row.depthRank === 1);
  const goalLine = eligible.filter(row => row.components.goalLineOpportunity >= 45).slice(0, 30);
  const redZoneTargets = eligible.filter(row => ["WR", "TE", "RB"].includes(row.position) && row.historicalPerGame.redZoneTargets >= 0.45).slice(0, 30);
  const surges = eligible.filter(row => row.trend === "opportunity_surge").slice(0, 30);

  const payload = {
    sport: "NFL",
    schemaVersion: "1.0",
    generatedAt,
    week: matchup.week,
    status: "private_shadow_board",
    market: "anytime_touchdown",
    recommendationStatus: "disabled",
    projectionStatus: "disabled",
    scoreLabel: "TD Signal Score",
    scoreDisclaimer: "The TD Signal Score is a private opportunity-ranking score. It is not a touchdown probability, betting recommendation, or published projection.",
    launchGate: "Requires verified regular-season role, opponent, defensive matchup, and game environment before recommendations can be considered.",
    inputs: {
      available: ["Canonical player identity", "Current team", "Depth chart", "Verified Week 1 opponent", "Historical rush/receiving touchdowns", "Red-zone carries and targets", "Inside-the-10 carries and targets", "Recent-six-game opportunity", "Historical team scoring environment", "Defense-versus-position TD vulnerability", "Roster-reported availability"],
      gated: ["Regular-season role confirmation", "Routes and snap participation", "Weather"]
    },
    weights: { historicalOpportunityComposite: 0.80, scoringEnvironment: 0.12, defensiveVulnerability: 0.06, pace: 0.02 },
    counts: {
      rankedPlayers: eligible.length,
      tdSmashSpot: smash.length,
      goalLineElite: goalLine.length,
      redZoneTargets: redZoneTargets.length,
      opportunitySurges: surges.length,
      publishableRecommendations: 0,
      verifiedOpponentAssignments: eligible.length,
      matchupAdjustedPlayers: eligible.length
    },
    sections: [
      section("all", "All", "Every player eligible for private TD opportunity review.", eligible),
      section("td_smash_spot", "TD Smash Spot", "Top-ranked starters by goal-line, red-zone, touchdown, and role context.", smash),
      section("goal_line_elite", "Goal-Line Elite", "Players with the strongest historical inside-the-10 opportunity.", goalLine),
      section("red_zone_targets", "Red-Zone Targets", "Pass catchers and backs with established red-zone target volume.", redZoneTargets),
      section("opportunity_surge", "Opportunity Surge", "Recent red-zone opportunity at least 20% above the weighted baseline.", surges),
      section("td_ai", "TD AI", "Balanced private shadow ranking across all currently available inputs.", top(30)),
      section("deep_td_signals", "Deep TD Signals", "Lower-ranked private touchdown signals for broader model review.", eligible.slice(30, 60)),
      section("top_5", "Top 5", "Top five private shadow signals.", top(5)),
      section("top_10", "Top 10", "Top ten private shadow signals.", top(10)),
      section("top_30", "Top 30", "Top thirty private shadow signals.", top(30))
    ],
    rows: eligible
  };

  write("nfl_td_decision_center.json", payload);
  health.generatedAt = generatedAt;
  health.sources.tdDecisionCenter = {
    status: "private_shadow_only",
    provider: "The Slip Lab",
    market: "anytime_touchdown",
    rankedPlayers: eligible.length,
    publishableRecommendations: 0,
  };
  health.status = "nfl_dress_rehearsal_private_gates_active";
  write("nfl_data_health.json", health);
  console.log(`Built private NFL TD Decision Center: ${eligible.length} ranked players, 0 publishable recommendations`);
}

try {
  main();
} catch (error) {
  console.error("NFL TD DECISION CENTER BUILD FAILED");
  console.error(error);
  process.exit(1);
}
