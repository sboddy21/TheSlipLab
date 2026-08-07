function rows(payload) {
  return Array.isArray(payload?.players) ? payload.players : [];
}

function eventId(parts) {
  return parts.map(value => String(value ?? "")).join("|");
}

export function buildIdentityLedger({ previousLedger = {}, previousPool = {}, currentPlayers = [], rejections = [], date, verifiedAt }) {
  const previousById = new Map(rows(previousPool).filter(row => row.playerId).map(row => [String(row.playerId), row]));
  const newEvents = [];

  for (const current of currentPlayers) {
    const previous = previousById.get(String(current.playerId));
    if (!previous || !previous.teamId || !current.teamId || String(previous.teamId) === String(current.teamId)) continue;
    newEvents.push({
      eventId: eventId(["TEAM_CHANGE", current.playerId, previous.teamId, current.teamId, date]),
      type: "TEAM_CHANGE",
      date,
      detectedAt: verifiedAt,
      playerId: Number(current.playerId),
      player: current.player,
      fromTeamId: Number(previous.teamId),
      fromTeam: previous.team,
      toTeamId: Number(current.teamId),
      toTeam: current.team,
      source: "MLB_ACTIVE_ROSTER_IDENTITY_COMPARISON"
    });
  }

  for (const rejection of rejections) {
    newEvents.push({
      eventId: eventId(["STALE_OWNERSHIP_REJECTED", rejection.playerId, rejection.rejectedTeamId, rejection.canonicalTeamId, date]),
      type: "STALE_OWNERSHIP_REJECTED",
      date,
      detectedAt: verifiedAt,
      playerId: Number(rejection.playerId),
      player: rejection.player,
      rejectedTeamId: Number(rejection.rejectedTeamId),
      rejectedTeam: rejection.rejectedTeam,
      canonicalTeamId: Number(rejection.canonicalTeamId),
      canonicalTeam: rejection.canonicalTeam,
      reason: rejection.reason,
      source: "MLB_CANONICAL_OWNERSHIP_RESOLUTION"
    });
  }

  const deduped = new Map();
  for (const event of [...(Array.isArray(previousLedger.events) ? previousLedger.events : []), ...newEvents]) {
    if (event?.eventId) deduped.set(event.eventId, event);
  }
  const events = [...deduped.values()]
    .sort((a, b) => String(b.detectedAt || b.date).localeCompare(String(a.detectedAt || a.date)))
    .slice(0, 1000);

  return {
    schemaVersion: "1.0",
    updatedAt: verifiedAt,
    date,
    source: "MLB Stats API canonical player identity",
    eventCount: events.length,
    newEventCount: newEvents.filter(event => !(previousLedger.events || []).some(old => old.eventId === event.eventId)).length,
    events
  };
}
