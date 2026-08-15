import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../website/data");
const read = filename => JSON.parse(fs.readFileSync(path.join(DATA, filename), "utf8"));
const write = (filename, payload) => fs.writeFileSync(path.join(DATA, filename), `${JSON.stringify(payload, null, 2)}\n`);

const pool = read("nfl_player_pool.json");
const usage = read("nfl_preseason_usage.json");
const roles = read("nfl_role_engine.json");
const generatedAt = new Date().toISOString();
const duplicatePoolIds = pool.players.map(player => player.playerId).filter((id, index, all) => all.indexOf(id) !== index);
const usageKeys = usage.players.flatMap(player => player.games.map(game => `${game.gameId}|${player.playerId}`));
const duplicateUsageKeys = usageKeys.filter((key, index, all) => all.indexOf(key) !== index);
const poolIds = new Set(pool.players.map(player => player.playerId));
const unmatchedUsage = usage.players.filter(player => !poolIds.has(player.playerId));
const ownershipWarnings = usage.players.filter(player => player.ownershipStatus !== "current_team_match");
const invalidUsage = usage.players.filter(player => !player.latestGame?.gameId || player.latestGame.opportunities < 0);
const criticalIssues = [
  ...(usage.processedGameCount !== usage.completedGameCount ? ["completed_game_reconciliation_failed"] : []),
  ...(usage.failures?.length ? ["completed_game_fetch_failures"] : []),
  ...(duplicatePoolIds.length ? ["duplicate_player_ids"] : []),
  ...(duplicateUsageKeys.length ? ["duplicate_player_game_rows"] : []),
  ...(invalidUsage.length ? ["invalid_usage_rows"] : [])
];

const rows = roles.roles.filter(role => role.preseasonParticipationStatus !== "team_without_final_game").map(role => ({
  playerId: role.playerId, playerName: role.playerName, team: role.team, position: role.position,
  depthRank: role.depth?.rank || null, roleLabel: role.roleLabel, roleScore: role.roleScore,
  confidence: role.confidence.score, readiness: role.readiness.status,
  participationStatus: role.preseasonParticipationStatus,
  games: role.preseasonUsage?.gameCount || 0,
  opportunities: role.preseasonUsage?.totals ? role.preseasonUsage.totals.passAttempts + role.preseasonUsage.totals.carries + role.preseasonUsage.totals.targets : 0,
  carries: role.preseasonUsage?.totals?.carries || 0, targets: role.preseasonUsage?.totals?.targets || 0,
  passAttempts: role.preseasonUsage?.totals?.passAttempts || 0,
  roleSignal: role.preseasonUsage?.roleSignal || "no_box_score_opportunity",
  signalPublication: role.preseasonUsage?.signalPublication || "not_available",
  startingUnitStatus: role.preseasonUsage?.startingUnitStatus || "unknown_not_in_box_score_source"
})).sort((a, b) => {
  const priority = value => ({ eligible_starter_context: 0, eligible_for_role_review: 1, context_only_backup_or_depth_role: 2, withheld_single_sample: 3, withheld_team_change: 4, not_available: 5 })[value] ?? 6;
  return priority(a.signalPublication) - priority(b.signalPublication) || b.opportunities - a.opportunities || a.playerName.localeCompare(b.playerName);
});

write("nfl_preseason_audit.json", {
  sport: "NFL", schemaVersion: "1.0", generatedAt,
  status: criticalIssues.length ? "failed" : "passed", criticalIssues,
  counts: { completedGames: usage.completedGameCount, processedGames: usage.processedGameCount, playerGameRows: usage.playerGameCount, usagePlayers: usage.playerCount, canonicalPlayers: pool.playerCount },
  checks: {
    completedGameReconciliation: usage.processedGameCount === usage.completedGameCount,
    duplicatePlayerIds: duplicatePoolIds.length,
    duplicatePlayerGameRows: duplicateUsageKeys.length,
    unmatchedUsagePlayers: unmatchedUsage.length,
    ownershipWarnings: ownershipWarnings.length,
    invalidUsageRows: invalidUsage.length
  },
  warnings: {
    unmatchedUsagePlayers: unmatchedUsage.map(player => ({ playerId: player.playerId, playerName: player.playerName, teamsAtGame: player.teamsAtGame })),
    ownership: ownershipWarnings.map(player => ({ playerId: player.playerId, playerName: player.playerName, currentTeam: player.team, teamsAtGame: player.teamsAtGame }))
  }
});

write("nfl_preseason_role_board.json", {
  sport: "NFL", schemaVersion: "1.0", generatedAt, status: "private_role_review",
  projectionStatus: "disabled", finalGameGate: true,
  disclaimer: "Private preseason role intelligence only. Missing box-score opportunity does not prove a player rested, and starting-unit participation is unknown.",
  counts: {
    rows: rows.length, withUsage: rows.filter(row => row.participationStatus === "box_score_opportunity_recorded").length,
    noBoxScoreOpportunity: rows.filter(row => row.participationStatus === "no_box_score_opportunity").length,
    reviewEligible: rows.filter(row => row.signalPublication === "eligible_starter_context").length
  },
  safeguards: ["Final games only", "Two samples required for movement review", "Team-change signals withheld", "Backup/depth signals labeled context-only", "Rest and starting-unit participation are not inferred"],
  rows
});

console.log(`NFL PRESEASON AUDIT ${criticalIssues.length ? "FAILED" : "PASSED"}: ${usage.processedGameCount} final games, ${rows.length} role rows`);
if (criticalIssues.length) process.exit(1);
