// Fail closed: a roster record is not evidence of active-roster eligibility.
export function isActiveRoster(player) {
  return ["active", "day-to-day"].includes(String(player?.status || "").toLowerCase());
}

export function depthMatchesPlayer(entry, player) {
  return Boolean(player && String(entry.playerId) === String(player.playerId) && entry.team === player.team && entry.position === player.position);
}

export function hasCurrentOfficialReport(report, player, week, now = Date.now()) {
  const age = now - Date.parse(report?.reportedAt || "");
  return Boolean(report && report.sourceCoverage === "official_weekly_practice_report" &&
    String(report.playerId) === String(player.playerId) && report.team === player.team &&
    Number(report.week) === Number(week) && Number.isFinite(age) && age >= 0 && age <= 12 * 3600000);
}
