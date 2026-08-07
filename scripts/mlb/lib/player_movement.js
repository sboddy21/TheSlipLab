function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value) {
  return Number(finite(value).toFixed(1));
}

export function explainPlayerMovement(current = {}, previous = null) {
  if (!previous) {
    return {
      status: "INITIAL_SNAPSHOT",
      direction: "NEW",
      confidenceDelta: 0,
      reasons: [{ key: "initial_snapshot", label: "Initial player snapshot", impact: "neutral" }]
    };
  }

  const reasons = [];
  const add = (key, label, from, to, impact) => reasons.push({ key, label, from, to, impact });
  const changedText = (a, b) => String(a || "") !== String(b || "");
  const numericChange = (key, label, field, threshold = 2) => {
    const from = finite(previous[field]);
    const to = finite(current[field]);
    const delta = to - from;
    if (Math.abs(delta) >= threshold) add(key, label, rounded(from), rounded(to), delta > 0 ? "support" : "risk");
  };

  if (changedText(current.lineupStatus, previous.lineupStatus)) {
    add("lineup_status", "Lineup status changed", previous.lineupStatus || "Unknown", current.lineupStatus || "Unknown", current.confirmedLineup ? "support" : "risk");
  }
  if (finite(current.lineupSpot) !== finite(previous.lineupSpot)) {
    const from = finite(previous.lineupSpot) || null;
    const to = finite(current.lineupSpot) || null;
    add("lineup_spot", "Batting-order position changed", from, to, to && (!from || to < from) ? "support" : "risk");
  }
  if (changedText(current.pitcher, previous.pitcher)) {
    add("probable_pitcher", "Probable pitcher changed", previous.pitcher || "TBD", current.pitcher || "TBD", "neutral");
  }
  numericChange("weather", "Weather environment moved", "weather", 3);
  numericChange("bullpen", "Bullpen matchup moved", "bullpen", 3);
  numericChange("pitch_edge", "Pitch-type edge moved", "pitchEdge", 3);

  const previousQuality = finite(previous.dataQuality?.score);
  const currentQuality = finite(current.dataQuality?.score);
  if (Math.abs(currentQuality - previousQuality) >= 5) {
    add("data_quality", "Data confidence changed", rounded(previousQuality), rounded(currentQuality), currentQuality > previousQuality ? "support" : "risk");
  }
  if (Boolean(current.marketAvailable) !== Boolean(previous.marketAvailable)) {
    add("market_coverage", "Player market coverage changed", Boolean(previous.marketAvailable), Boolean(current.marketAvailable), current.marketAvailable ? "support" : "risk");
  }
  if (finite(current.bestOverPrice) && finite(previous.bestOverPrice) && finite(current.bestOverPrice) !== finite(previous.bestOverPrice)) {
    add("market_price", "Best market price moved", finite(previous.bestOverPrice), finite(current.bestOverPrice), "neutral");
  }

  // The published endpoints are one-decimal values. Derive the delta from those
  // same values so validators and consumers cannot disagree because of hidden
  // precision (for example 50.04 -> 50.06 publishes as 50.0 -> 50.1).
  const previousConfidence = rounded(previous.hrConfidence);
  const currentConfidence = rounded(current.hrConfidence);
  const confidenceDelta = rounded(currentConfidence - previousConfidence);
  const direction = confidenceDelta >= 0.2 ? "UP" : confidenceDelta <= -0.2 ? "DOWN" : "UNCHANGED";
  if (direction !== "UNCHANGED") {
    add("model_confidence", "Quality-adjusted model confidence moved", rounded(previous.hrConfidence), rounded(current.hrConfidence), direction === "UP" ? "support" : "risk");
  }

  return {
    status: reasons.length ? "CHANGED" : "STABLE",
    direction,
    confidenceDelta,
    previousConfidence,
    currentConfidence,
    reasons
  };
}
