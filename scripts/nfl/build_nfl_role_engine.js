import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../website/data");

function read(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA, filename), "utf8"));
}

function write(filename, payload) {
  fs.writeFileSync(path.join(DATA, filename), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Built website/data/${filename}`);
}

const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));
const round = value => Math.round((Number(value) || 0) * 10) / 10;

function roleLabel(position, rank, hasHistory) {
  if (!rank) return hasHistory ? "Roster role pending" : "Unresolved camp role";
  if (position === "QB") return rank === 1 ? "Starting quarterback" : rank === 2 ? "Primary backup quarterback" : "Depth quarterback";
  if (position === "RB") return rank === 1 ? "Lead-back candidate" : rank === 2 ? "Committee-back candidate" : rank === 3 ? "Rotational back" : "Depth back";
  if (position === "WR") return rank === 1 ? "Starting receiver" : rank === 2 ? "Rotational receiver" : "Depth receiver";
  if (position === "TE") return rank === 1 ? "Starting tight end" : rank === 2 ? "Rotational tight end" : "Depth tight end";
  return "Role pending";
}

function historicalUsageScore(position, baseline = {}) {
  if (position === "QB") return clamp((baseline.passAttempts / 36) * 100);
  if (position === "RB") return clamp(((baseline.carries + baseline.targets) / 22) * 100);
  return clamp(((baseline.targets + baseline.carries) / 10) * 100);
}

function opportunityValue(position, baseline = {}) {
  if (position === "QB") return Number(baseline.passAttempts || 0) + Number(baseline.carries || 0);
  return Number(baseline.targets || 0) + Number(baseline.carries || 0);
}

function injuryReadiness(injury) {
  const status = String(injury?.status || "").toLowerCase();
  if (status.includes("injured reserve")) return { status: "unavailable", multiplier: 0, reason: injury.status };
  if (status.includes("out")) return { status: "unavailable", multiplier: 0.2, reason: injury.status };
  if (status.includes("questionable")) return { status: "limited", multiplier: 0.8, reason: injury.status };
  return { status: "active_no_roster_injury", multiplier: 1, reason: "No injury attached in the current roster feed." };
}

function confidence({ depth, history, continuityKnown }) {
  let score = 10;
  const components = { canonicalIdentity: 10, depthChart: 0, historicalUsage: 0, teamContinuity: 0, injuryCoverage: 5, preseasonUsage: 0 };
  if (depth) { components.depthChart = 35; score += 35; }
  if (history?.historicalGames >= 24) components.historicalUsage = 30;
  else if (history?.historicalGames >= 8) components.historicalUsage = 20;
  else if (history?.historicalGames > 0) components.historicalUsage = 10;
  score += components.historicalUsage;
  if (continuityKnown) { components.teamContinuity = 10; score += 10; }
  score += components.injuryCoverage;
  return { score: clamp(score), components, ceiling: 90, missing: ["preseasonUsage", ...(depth ? [] : ["depthChart"]), ...(history ? [] : ["historicalUsage"])] };
}

function main() {
  const pool = read("nfl_player_pool.json");
  const depth = read("nfl_depth_charts.json");
  const injuries = read("nfl_injuries.json");
  const usage = read("nfl_usage_baselines.json");
  const preseason = read("nfl_preseason_usage.json");
  const health = read("nfl_data_health.json");
  const usageByPlayer = new Map(usage.profiles.map(profile => [profile.playerId, profile]));
  const preseasonByPlayer = new Map(preseason.players.map(profile => [profile.playerId, profile]));
  const injuryByPlayer = new Map(injuries.injuries.map(injury => [injury.playerId, injury]));
  const depthByPlayer = new Map();
  for (const entry of depth.entries.filter(entry => entry.canonicalPlayerMatch)) {
    const current = depthByPlayer.get(entry.playerId);
    if (!current || entry.rank < current.rank) depthByPlayer.set(entry.playerId, entry);
  }

  const roles = pool.players.map(player => {
    const depthEntry = depthByPlayer.get(player.playerId) || null;
    const history = usageByPlayer.get(player.playerId) || null;
    const injury = injuryByPlayer.get(player.playerId) || null;
    const preseasonUsage = preseasonByPlayer.get(player.playerId) || null;
    const readiness = injuryReadiness(injury);
    const rank = Number(depthEntry?.rank || 0);
    const depthScore = rank ? ({ 1: 100, 2: 65, 3: 35, 4: 15 }[rank] ?? 5) : 0;
    const historyScore = historicalUsageScore(player.position, history?.weightedPerGame);
    const rawRoleScore = depthEntry && history ? depthScore * 0.6 + historyScore * 0.4 : depthEntry ? depthScore * 0.8 : historyScore * 0.5;
    const weighted = history?.weightedPerGame || {};
    const recent = history?.recentSixGamesPerGame || {};
    const baselineOpportunity = opportunityValue(player.position, weighted);
    const recentOpportunity = opportunityValue(player.position, recent);
    const recentRatio = baselineOpportunity > 0 ? recentOpportunity / baselineOpportunity : null;
    const continuityKnown = Boolean(history?.mostRecentHistoricalTeam);
    const confidenceResult = confidence({ depth: depthEntry, history, continuityKnown });
    if (preseasonUsage) {
      confidenceResult.components.preseasonUsage = Math.min(10, preseasonUsage.gameCount * 5);
      confidenceResult.score = Math.min(confidenceResult.ceiling, clamp(confidenceResult.score + confidenceResult.components.preseasonUsage));
      confidenceResult.missing = confidenceResult.missing.filter(item => item !== "preseasonUsage");
    }

    return {
      playerId: player.playerId,
      gsisId: depthEntry?.gsisId || history?.gsisId || "",
      playerName: player.fullName,
      team: player.team,
      position: player.position,
      depth: depthEntry ? { rank, slot: depthEntry.slot, starter: depthEntry.starter, snapshotAt: depthEntry.snapshotAt } : null,
      roleLabel: roleLabel(player.position, rank, Boolean(history)),
      roleScore: round(rawRoleScore * readiness.multiplier),
      roleScoreBeforeAvailability: round(rawRoleScore),
      historicalUsageScore: round(historyScore),
      readiness,
      teamContext: history ? {
        mostRecentHistoricalTeam: history.mostRecentHistoricalTeam,
        currentTeamContinuity: history.currentTeamContinuity,
        changedTeams: history.mostRecentHistoricalTeam ? !history.currentTeamContinuity : null
      } : { mostRecentHistoricalTeam: "", currentTeamContinuity: false, changedTeams: null },
      trend: recentRatio === null ? "no_history" : recentRatio >= 1.15 ? "opportunity_up" : recentRatio <= 0.85 ? "opportunity_down" : "stable",
      historicalOpportunity: history ? {
        games: history.historicalGames,
        weightedPerGame: history.weightedPerGame,
        recentSixGamesPerGame: history.recentSixGamesPerGame
      } : null,
      preseasonUsage: preseasonUsage ? {
        gameCount: preseasonUsage.gameCount,
        totals: preseasonUsage.totals,
        latestGame: preseasonUsage.latestGame,
        previousGame: preseasonUsage.previousGame,
        roleSignal: preseasonUsage.roleSignal
      } : null,
      confidence: confidenceResult,
      modelEligibility: readiness.status !== "unavailable" && Boolean(depthEntry) && Boolean(history),
      projectionStatus: "disabled_pending_preseason_usage_and_market_lines"
    };
  }).sort((a, b) => b.roleScore - a.roleScore || a.team.localeCompare(b.team) || a.playerName.localeCompare(b.playerName));

  const generatedAt = new Date().toISOString();
  write("nfl_role_engine.json", {
    sport: "NFL", schemaVersion: "1.0", season: pool.season, generatedAt,
    status: "role_estimation_only",
    disclaimer: "Role scores rank current opportunity certainty. They are not player-stat projections, probabilities, or betting recommendations.",
    methodology: {
      roleScore: "Depth-chart score blended with position-normalized historical opportunity, then availability-adjusted.",
      confidenceCeiling: 90,
      confidenceCeilingReason: "Verified preseason box-score opportunity is included, but snap and route data remain unavailable.",
      injuryCoverage: "Partial preseason roster coverage; absence of an injury is not a confirmed healthy designation."
    },
    playerCount: roles.length,
    playersWithDepth: roles.filter(role => role.depth).length,
    playersWithHistory: roles.filter(role => role.historicalOpportunity).length,
    modelEligibleCount: roles.filter(role => role.modelEligibility).length,
    unavailableCount: roles.filter(role => role.readiness.status === "unavailable").length,
    roles
  });

  health.generatedAt = generatedAt;
  health.sources.roleEngine = { status: "available", provider: "The Slip Lab", roleCount: roles.length, type: "role_estimation_only" };
  health.sources.preseasonUsage = { status: preseason.processedGameCount ? "available" : "waiting", provider: "ESPN completed-game box scores", finalGameGate: true, processedGames: preseason.processedGameCount, playerProfiles: preseason.playerCount };
  health.status = "role_engine_ready_projections_gated";
  write("nfl_data_health.json", health);
}

try {
  main();
} catch (error) {
  console.error("NFL ROLE ENGINE BUILD FAILED");
  console.error(error);
  process.exit(1);
}
