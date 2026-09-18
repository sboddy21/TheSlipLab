export function auditSnapshotCoverage(results, schedule) {
  const generatedAt = Date.parse(results.generatedAt);
  const snapshots = Array.isArray(results.snapshots) ? results.snapshots : [];
  const games = (schedule.games || []).filter(game => game.seasonType === 2 && game.week === results.week);
  const currentWeekSnapshots = snapshots.filter(row => row.week === results.week);
  const keys = currentWeekSnapshots.map(row => `${row.week}|${row.gameId}`);
  const duplicateKeys = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  const invalidSnapshots = snapshots.filter(row => !row.gameId || !row.kickoffUTC || !Number.isFinite(Date.parse(row.snapshotAt)) || Date.parse(row.snapshotAt) >= Date.parse(row.kickoffUTC));
  const lockedGames = new Set(currentWeekSnapshots.map(row => String(row.gameId)));
  const requiredGames = games.filter(game => Number.isFinite(generatedAt) && Date.parse(game.kickoffUTC) > generatedAt);
  const missingRequiredGameIds = requiredGames.filter(game => !lockedGames.has(String(game.gameId))).map(game => String(game.gameId));
  const missedBeforeRefreshGameIds = games.filter(game => Date.parse(game.kickoffUTC) <= generatedAt && !lockedGames.has(String(game.gameId))).map(game => String(game.gameId));
  return {
    currentWeekGames: games.length,
    currentWeekLocks: currentWeekSnapshots.length,
    requiredAtRefresh: requiredGames.length,
    missingRequiredGameIds,
    missedBeforeRefreshGameIds,
    duplicateKeys,
    invalidSnapshotIds: invalidSnapshots.map(row => row.snapshotId || `${row.week}|${row.gameId || "missing"}`)
  };
}
