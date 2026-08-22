const MARKETS = ["points", "rebounds", "assists", "threes"];
const THRESHOLDS = { points: 1.5, rebounds: .7, assists: .7, threes: .4 };
const round = value => Number(Number(value).toFixed(1));
const injuryLabel = row => row?.injury?.status || "Available";

function change({ type, player, current, previous, market = null, magnitude = 0, direction = "changed" }) {
  return { type, playerId: current?.playerId || previous?.playerId, player: current?.player || previous?.player, team: current?.team || previous?.team, opponent: current?.opponent || previous?.opponent, market, direction, magnitude: round(magnitude) };
}

export function buildWnbaChanges(previousSnapshot, currentSnapshot) {
  if (!previousSnapshot || previousSnapshot.date !== currentSnapshot.date) return [];
  const previousById = new Map((previousSnapshot.projections || []).map(row => [String(row.playerId), row]));
  const currentById = new Map((currentSnapshot.projections || []).map(row => [String(row.playerId), row]));
  const changes = [];
  for (const [id, current] of currentById) {
    const previous = previousById.get(id);
    if (!previous) { changes.push(change({ type: "board_entry", player: current, current, magnitude: 10, direction: "entered" })); continue; }
    const minuteDelta = round(current.expectedMinutes - previous.expectedMinutes);
    if (Math.abs(minuteDelta) >= 1) changes.push({ ...change({ type: "minutes", current, previous, magnitude: Math.abs(minuteDelta), direction: minuteDelta > 0 ? "up" : "down" }), previousValue: previous.expectedMinutes, currentValue: current.expectedMinutes });
    for (const market of MARKETS) {
      const previousValue = Number(previous.projections?.[market]?.value);
      const currentValue = Number(current.projections?.[market]?.value);
      const delta = round(currentValue - previousValue);
      if (Number.isFinite(delta) && Math.abs(delta) >= THRESHOLDS[market]) changes.push({ ...change({ type: "projection", current, previous, market, magnitude: Math.abs(delta), direction: delta > 0 ? "up" : "down" }), previousValue, currentValue });
    }
    if (current.role !== previous.role) changes.push({ ...change({ type: "role", current, previous, magnitude: 8 }), previousValue: previous.role, currentValue: current.role });
    if (injuryLabel(current) !== injuryLabel(previous)) changes.push({ ...change({ type: "injury", current, previous, magnitude: 12 }), previousValue: injuryLabel(previous), currentValue: injuryLabel(current) });
  }
  for (const [id, previous] of previousById) if (!currentById.has(id)) changes.push(change({ type: "board_exit", previous, magnitude: 10, direction: "exited" }));
  return changes.sort((a, b) => b.magnitude - a.magnitude || a.player.localeCompare(b.player)).slice(0, 50);
}

export function buildWnbaChangeFeed(previousSnapshot, currentSnapshot) {
  const changes = buildWnbaChanges(previousSnapshot, currentSnapshot);
  return { sport: "WNBA", date: currentSnapshot.date, generatedAt: currentSnapshot.generatedAt, status: previousSnapshot?.date === currentSnapshot.date ? "ready" : "baseline_established", count: changes.length, changes };
}
