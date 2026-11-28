export function validStabilizedPitcherRisk(score, raw, baseline, weight) {
  if (![score, raw, baseline, weight].every(Number.isFinite)) return false;
  const expected = Math.max(12, Math.min(98, Math.round(baseline + (raw - baseline) * weight)));
  return Math.abs(score - expected) <= 1;
}
