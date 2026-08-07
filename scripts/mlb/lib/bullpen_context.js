function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function sampleAdjustedRelieverRisk(rawRisk, inningsPitched) {
  const reliability = clamp(finite(inningsPitched) / 25, 0, 1);
  return 45 + (clamp(finite(rawRisk), 0, 100) - 45) * reliability;
}

export function isRelieverProfile(row = {}) {
  const games = Math.max(0, finite(row.gamesPitched));
  const starts = Math.max(0, finite(row.gamesStarted));
  if (!games) return false;
  return starts <= Math.max(3, games * 0.35);
}

export function summarizeBullpen(team, rows = []) {
  const relievers = rows.filter(isRelieverProfile);
  const weighted = relievers.map(row => {
    const innings = Math.max(0, finite(row.inningsPitched));
    const adjustedRisk = sampleAdjustedRelieverRisk(row.hrRiskScore, innings);
    const leverageWeight = 1 + Math.min(0.75, finite(row.saves) * 0.04 + finite(row.holds) * 0.02);
    return { row, innings, adjustedRisk, weight: leverageWeight };
  });
  const weight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const bullpenRiskScore = weight
    ? weighted.reduce((sum, item) => sum + item.adjustedRisk * item.weight, 0) / weight
    : 45;
  const totalInnings = weighted.reduce((sum, item) => sum + item.innings, 0);

  return {
    team,
    relieverCount: relievers.length,
    bullpenRiskScore: Number(bullpenRiskScore.toFixed(1)),
    sampleInnings: Number(totalInnings.toFixed(1)),
    confidence: totalInnings >= 150 ? "HIGH" : totalInnings >= 75 ? "MEDIUM" : "LOW",
    leftHandedRelievers: relievers.filter(row => String(row.hand).toUpperCase().startsWith("L")).length,
    rightHandedRelievers: relievers.filter(row => String(row.hand).toUpperCase().startsWith("R")).length,
    highestRiskRelievers: weighted
      .sort((a, b) => b.adjustedRisk - a.adjustedRisk)
      .slice(0, 3)
      .map(item => ({
        playerId: item.row.playerId,
        pitcher: item.row.pitcher,
        hand: item.row.hand || "",
        adjustedRisk: Number(item.adjustedRisk.toFixed(1)),
        inningsPitched: item.row.inningsPitched
      }))
  };
}

export function projectPitchingExposure(expectedPlateAppearances, starterRisk, bullpenRisk) {
  const expected = clamp(finite(expectedPlateAppearances, 4.05), 0, 4.75);
  const starterShare = expected === 0 ? 0 : 0.58;
  const bullpenShare = expected === 0 ? 0 : 0.42;
  return {
    starterPlateAppearances: Number((expected * starterShare).toFixed(2)),
    bullpenPlateAppearances: Number((expected * bullpenShare).toFixed(2)),
    starterShare,
    bullpenShare,
    starterRisk: Number(clamp(finite(starterRisk), 0, 100).toFixed(1)),
    bullpenRisk: Number(clamp(finite(bullpenRisk), 0, 100).toFixed(1)),
    blendedPitchingRisk: Number((finite(starterRisk) * starterShare + finite(bullpenRisk) * bullpenShare).toFixed(1))
  };
}
