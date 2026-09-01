function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function grade(score, out) {
  if (out) return "OUT";
  if (score >= 90) return "A";
  if (score >= 78) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "LOW";
}

export function buildDataQualityConfidence(input = {}) {
  const status = String(input.lineupStatus || "").toUpperCase();
  const out = status === "NOT IN LINEUP";
  const lineup = out ? 0 : input.confirmedLineup ? 100 : finite(input.lineupSpot) > 0 ? 75 : 50;
  const pitcher = input.pitcherConfirmed === false ? 35 : input.zoneSignalAvailable === false ? 60 : 100;
  const statcast = clamp(finite(input.statcastReliability) * 100, 0, 100);
  const bullpen = ({ HIGH: 100, MEDIUM: 78, LOW: 55 }[String(input.bullpenConfidence || "").toUpperCase()] ?? 55);
  const market = input.marketFeedAvailable ? input.marketAvailable ? 100 : 45 : 60;
  const marketFreshness = input.marketFeedAvailable
    ? clamp(100 - Math.max(0, finite(input.marketAgeMinutes) - 5) * 5, 25, 100)
    : 60;
  const score = out ? 0 : clamp(
    lineup * 0.30 + pitcher * 0.22 + statcast * 0.20 + bullpen * 0.12 + market * 0.10 + marketFreshness * 0.06,
    0,
    100
  );
  const penaltyFactor = out ? 0 : 0.85 + score / 100 * 0.15;
  const flags = [];
  if (!out && lineup < 100) flags.push("LINEUP_UNCONFIRMED");
  if (!out && pitcher < 100) flags.push("PITCHER_UNCERTAIN");
  if (!out && statcast < 40) flags.push("SMALL_STATCAST_SAMPLE");
  if (!out && bullpen < 70) flags.push("LIMITED_BULLPEN_SAMPLE");
  if (!out && market < 60) flags.push("NO_PLAYER_MARKET");
  if (!out && marketFreshness < 70) flags.push("MARKET_AGING");

  return {
    score: Number(score.toFixed(1)),
    grade: grade(score, out),
    penaltyFactor: Number(penaltyFactor.toFixed(4)),
    flags,
    components: { lineup, pitcher, statcast: Number(statcast.toFixed(1)), bullpen, market, marketFreshness: Number(marketFreshness.toFixed(1)) }
  };
}

export function normalizeModelConfidence(modelConfidence) {
  return Number(clamp(finite(modelConfidence), 0, 100).toFixed(1));
}

export function applyDataQualityPenalty(modelConfidence, quality) {
  if (quality?.grade === "OUT") return 0;
  const normalizedConfidence = normalizeModelConfidence(modelConfidence);
  return Math.min(
    normalizedConfidence,
    Number((normalizedConfidence * clamp(finite(quality?.penaltyFactor, 0.85), 0.85, 1)).toFixed(1))
  );
}

export function dataQualityPenaltyIssue(rawConfidence, adjustedConfidence, quality) {
  const raw = Number(rawConfidence);
  const adjusted = Number(adjustedConfidence);
  const factor = Number(quality?.penaltyFactor);

  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return "invalid raw confidence";
  if (!Number.isFinite(adjusted) || adjusted < 0 || adjusted > 100) return "invalid adjusted confidence";
  if (quality?.grade === "OUT") return adjusted === 0 ? "" : "out player retained adjusted confidence";
  if (!Number.isFinite(factor) || factor < 0.85 || factor > 1) return "penalty factor outside 0.85-1.00";
  if (adjusted > raw) return "adjusted confidence exceeds raw confidence";
  return "";
}
