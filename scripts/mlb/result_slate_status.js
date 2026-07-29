function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function terminalNonPlayedCount(payload) {
  if (Array.isArray(payload?.terminalNonPlayed)) return payload.terminalNonPlayed.length;
  return number(payload?.terminalNonPlayedGames);
}

export function completedResultSlate(payload) {
  const scheduled = number(payload?.totalScheduledGames ?? payload?.scheduledGames);
  const settled = number(payload?.finalGames) + terminalNonPlayedCount(payload);

  return scheduled > 0
    && settled === scheduled
    && number(payload?.liveGames) === 0
    && number(payload?.skippedGames) === 0;
}

export function playableScheduledGames(payload) {
  const scheduled = number(payload?.totalScheduledGames ?? payload?.scheduledGames);
  const rescheduled = Array.isArray(payload?.rescheduledGames)
    ? payload.rescheduledGames.length
    : number(payload?.rescheduledGameCount);
  return Math.max(0, scheduled - terminalNonPlayedCount(payload) - rescheduled);
}

export function terminalNonPlayedGamePks(payload) {
  return new Set(
    (Array.isArray(payload?.terminalNonPlayed) ? payload.terminalNonPlayed : [])
      .map(game => Number(game?.gamePk))
      .filter(Number.isFinite)
  );
}

export function rescheduledGamePks(payload) {
  return new Set(
    (Array.isArray(payload?.rescheduledGames) ? payload.rescheduledGames : [])
      .map(game => Number(game?.gamePk))
      .filter(Number.isFinite)
  );
}
