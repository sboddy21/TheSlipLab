function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export const BASELINE_GAME_PA = 4.3;

export function lineupConfidence({ lineupStatus, confirmedLineup, lineupSpot } = {}) {
  if (String(lineupStatus || "").toUpperCase() === "NOT IN LINEUP") return "OUT";
  if (confirmedLineup && finite(lineupSpot) >= 1) return "HIGH";
  if (finite(lineupSpot) >= 1) return "MEDIUM";
  return "LOW";
}

export function adjustProbabilityForPlateAppearances(baseProbability, expectedPlateAppearances, options = {}) {
  const base = clamp(finite(baseProbability), 0, 100);
  const status = String(options.lineupStatus || "").toUpperCase();
  if (status === "NOT IN LINEUP") return 0;

  const expected = clamp(finite(expectedPlateAppearances, 4.05), 3.7, 4.75);
  if (base === 0 || base === 100) return base;

  // Convert the calibrated game probability to a per-PA probability, then
  // rebuild it using today's expected opportunities. This avoids treating a
  // leadoff hitter and a ninth-place hitter as if they receive equal volume.
  const perPa = 1 - Math.pow(1 - base / 100, 1 / BASELINE_GAME_PA);
  return clamp((1 - Math.pow(1 - perPa, expected)) * 100, 0, 24);
}
