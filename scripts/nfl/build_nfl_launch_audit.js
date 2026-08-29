import fs from "fs";
import path from "path";

const DATA = path.resolve("website/data");
const read = file => JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
const write = (file, payload) => fs.writeFileSync(path.join(DATA, file), `${JSON.stringify(payload, null, 2)}\n`);
const pool = read("nfl_player_pool.json");
const depth = read("nfl_depth_charts.json");
const roles = read("nfl_role_engine.json");
const matchup = read("nfl_matchup_context.json");
const practice = read("nfl_practice_reports.json");
const weather = read("nfl_weather.json");
const td = read("nfl_td_decision_center.json");
const receiving = read("nfl_receiving_yards_board.json");
const health = read("nfl_data_health.json");
const generatedAt = new Date().toISOString();

const poolById = new Map(pool.players.map(row => [row.playerId, row]));
const duplicateIds = pool.players.filter((row, index, all) => all.findIndex(other => other.playerId === row.playerId) !== index);
const duplicateNames = pool.players.filter((row, index, all) => all.findIndex(other => other.fullName === row.fullName) !== index);
const invalidRosterStatuses = pool.players.filter(row => !["active", "day-to-day"].includes(String(row.status).toLowerCase()));
const roleTeamMismatches = roles.roles.filter(row => poolById.get(row.playerId)?.team !== row.team);
const matchupTeamMismatches = matchup.playerAssignments.filter(row => poolById.get(row.playerId)?.team !== row.team);
const tdTeamMismatches = td.rows.filter(row => poolById.get(row.playerId)?.team !== row.team);
const receivingTeamMismatches = receiving.rows.filter(row => poolById.get(row.playerId)?.team !== row.team);
const inactiveLeakage = [...td.rows, ...receiving.rows].filter(row => row.gates?.activeRoster !== true);
const identityCritical = duplicateIds.length + duplicateNames.length + invalidRosterStatuses.length + roleTeamMismatches.length + matchupTeamMismatches.length + tdTeamMismatches.length + receivingTeamMismatches.length + inactiveLeakage.length;
const tdRequiredGates = row => row.gates?.activeRoster && row.gates?.verifiedOpponent && row.gates?.defensiveMatchup && row.gates?.gameEnvironment && row.gates?.regularSeasonRoleConfirmed;
const receivingRequiredGates = row => row.gates?.activeRoster && row.gates?.verifiedOpponent && row.gates?.weather && row.gates?.regularSeasonRoleConfirmed && row.gates?.routeParticipation;
const blockers = [
  ...(identityCritical ? [`${identityCritical} critical identity/ownership issues`] : []),
  ...(practice.officialReportsActive ? [] : ["Official Week 1 practice reports are not active"]),
  ...(weather.counts.pending ? [`${weather.counts.pending} games lack kickoff-hour weather`] : []),
  ...(td.rows.some(tdRequiredGates) ? [] : ["No TD rows pass every required launch gate"]),
  ...(receiving.rows.some(receivingRequiredGates) ? [] : ["Receiving yards lacks verified route participation"])
];

const payload = {
  sport: "NFL", schemaVersion: "1.0", generatedAt, week: matchup.week,
  status: blockers.length ? "private_launch_blocked" : "ready_for_manual_public_launch",
  publicLaunchAutomatic: false,
  publicNavigationEnabled: false,
  policy: {
    currentRosterIsAuthoritative: true,
    staleDepthEntriesExcluded: true,
    tdRoutesRequired: false,
    receivingRoutesRequired: true,
    manualApprovalRequiredToEnableNavigation: true
  },
  checks: {
    canonicalPlayers: pool.playerCount,
    duplicatePlayerIds: duplicateIds.length,
    duplicatePlayerNames: duplicateNames.length,
    invalidRosterStatuses: invalidRosterStatuses.length,
    roleTeamMismatches: roleTeamMismatches.length,
    matchupTeamMismatches: matchupTeamMismatches.length,
    tdTeamMismatches: tdTeamMismatches.length,
    receivingTeamMismatches: receivingTeamMismatches.length,
    inactiveRowsLeaked: inactiveLeakage.length,
    staleDepthEntriesExcluded: depth.sourceUnmatchedExcludedCount || 0,
    unresolvedDepthEntries: depth.unmatchedPlayerCount,
    weatherReadyGames: weather.counts.gatedReady,
    weatherGames: weather.counts.games,
    officialReportsActive: practice.officialReportsActive,
    tdLaunchEligible: td.rows.filter(tdRequiredGates).length,
    receivingLaunchEligible: receiving.rows.filter(receivingRequiredGates).length
  },
  blockers
};

write("nfl_launch_audit.json", payload);
health.generatedAt = generatedAt;
health.sources = health.sources || {};
health.sources.launchAudit = {
  status: payload.status,
  checkedAt: generatedAt,
  criticalIdentityIssues: identityCritical,
  blockerCount: blockers.length,
  publicNavigationEnabled: false
};
write("nfl_data_health.json", health);
console.log(`NFL LAUNCH AUDIT ${blockers.length ? "BLOCKED" : "READY"}: ${identityCritical} identity issues, ${blockers.length} launch blockers`);
