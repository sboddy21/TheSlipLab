export function belongsToRefresh(timestamp, refreshStartedAt, toleranceMs = 1000) {
  return Number.isFinite(timestamp)
    && Number.isFinite(refreshStartedAt)
    && timestamp >= refreshStartedAt - toleranceMs;
}

export function isFreshForRefresh({
  timestamp,
  generatedAt,
  maxAgeMs,
  refreshStartedAt,
  toleranceMs = 1000,
  maxRefreshDurationMs = 30 * 60 * 1000
}) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(generatedAt) || !Number.isFinite(maxAgeMs)) return false;
  const refreshDuration = generatedAt - refreshStartedAt;
  const validCurrentRefresh = Number.isFinite(refreshDuration)
    && refreshDuration >= -toleranceMs
    && refreshDuration <= maxRefreshDurationMs;
  return (validCurrentRefresh && belongsToRefresh(timestamp, refreshStartedAt, toleranceMs))
    || generatedAt - timestamp <= maxAgeMs;
}
