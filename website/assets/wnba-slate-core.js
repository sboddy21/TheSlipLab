export const WNBA_PRESENTATION_MAX_AGE_MS = 6 * 60 * 60_000;

export function wnbaSlateFreshness({ projectionData, slateDate, now = Date.now(), maxAgeMs = WNBA_PRESENTATION_MAX_AGE_MS }) {
  const asOf = Date.parse(projectionData?.dataAsOf || "");
  const ageMs = now - asOf;
  const sameSlate = Boolean(slateDate) && String(projectionData?.date || "") === String(slateDate);
  const usable = !projectionData?.stale
    && sameSlate
    && Number.isFinite(asOf)
    && ageMs >= 0
    && ageMs <= maxAgeMs;
  return { usable, ageMs, delayed: usable && ageMs > 30 * 60_000 };
}

export function teamScoringLeaderText(teamAbbreviation, players = []) {
  const leader = [...players]
    .filter(player => player?.teamAbbreviation === teamAbbreviation && Number.isFinite(Number(player?.season?.points)))
    .sort((a, b) => Number(b.season.points) - Number(a.season.points))[0];
  return leader ? `${leader.player} · ${Number(leader.season.points).toFixed(1)} PPG` : "Leader data unavailable";
}
