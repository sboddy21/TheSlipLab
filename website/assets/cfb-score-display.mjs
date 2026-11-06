export const wholeScore = value => Number.isFinite(value) ? String(Math.round(value)) : '—';

// Score pairs in AI prose are displayed as an attainable whole-point score.
// Standalone spreads, totals, probabilities and prices retain their precision.
export function wholeScoreText(value) {
  return String(value ?? '').replace(/\b(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\b/g,
    (pair, away, home) => away.includes('.') || home.includes('.') ? `${Math.round(Number(away))}–${Math.round(Number(home))}` : pair);
}
