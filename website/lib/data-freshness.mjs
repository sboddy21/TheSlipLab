import { currentSeasonStart, seasonStart } from './current-season.mjs';
// Shared by the data endpoint and the offline audit. Never use deployment time
// or filesystem mtime as evidence that a provider's data is current.
const ARCHIVES = /(?:^|_)(?:backtest|calibration|results|projection_history)(?:_|\.)|^hr_ai_(?:history|hof)\.|^cfb_daily_(?:evaluation|predictions)\./;
const REFERENCE = new Set(["ncaam_validation.json", "ncaam_model.json", "mlb_park_shapes.json", "mlb_park_factors.json"]);
const MONITORS = new Set(["health_status.json", "nfl_data_health.json", "nfl_launch_audit.json", "nfl_public_status.json"]);

export function sourceDependencies(file) {
  if (!freshnessPolicy(file)) return [];
  if (/^(mlb_(?:home_runs|hits|total_bases|rbis|pitcher_strikeouts)|hr_(?:decision_center|ai_breakdowns))\.json$/.test(file)) {
    return ['mlb_games_today.json', 'mlb_player_pool.json', 'mlb_weather.json', ...(file === 'hr_decision_center.json' ? ['mlb_market_odds.json'] : [])];
  }
  if (file === 'nfl_market_lines.json') return ['odds_nfl.json'];
  if (file === "nba_market_lines.json") return ["odds_nba.json"];
  if (file.startsWith("nba_") && !["nba_games_today.json", "nba_history.json", "nba_availability.json", "nba_player_pool.json"].includes(file)) {
    return ["nba_games_today.json", "nba_history.json", "nba_availability.json", "nba_player_pool.json", ...(file === "nba_verified_markets.json" ? ["nba_market_lines.json", "odds_nba.json"] : [])];
  }
  if (["wnba_projection_board.json", "wnba_verified_markets.json", "wnba_change_feed.json", "wnba_live_snapshot.json"].includes(file)) {
    return ["wnba_games_today.json", "wnba_player_baselines.json", "wnba_team_baselines.json", ...(file === "wnba_verified_markets.json" ? ["wnba_market_lines.json", "odds_wnba.json"] : [])];
  }
  if (/^nfl_(?:foundation|markets|decision_center|td_decision_center|receiving_yards_board|matchup_context)\.json$/.test(file)) {
    return ["nfl_schedule.json", "nfl_injuries.json", "nfl_player_pool.json", "nfl_depth_charts.json", "nfl_usage_baselines.json", "nfl_current_usage.json"];
  }
  return [];
}

export async function verifyCurrentDataset(file, payload, { load, now = Date.now(), health = null } = {}) {
  const memo = new Map();
  async function visit(name, data, ancestors = new Set()) {
    if (ancestors.has(name)) return { available: false, status: 'unavailable', reasons: ['source_dependency_cycle'] };
    if (memo.has(name)) return memo.get(name);
    const result = checkDataFreshness(name, data, { now, health });
    if (!result.available || !load) return result;
    const next = new Set([...ancestors, name]);
    const dependencies = await Promise.all(sourceDependencies(name).map(async dependency => {
      try { return { file: dependency, ...await visit(dependency, await load(dependency), next) }; }
      catch { return { file: dependency, available: false, reasons: ['missing_source_dependency'] }; }
    }));
    const verified = dependencies.some(row => !row.available)
      ? { ...result, available: false, status: 'unavailable', reasons: ['upstream_data_unavailable'], dependencies }
      : { ...result, dependencies };
    memo.set(name, verified);
    return verified;
  }
  return visit(file, payload);
}

export function freshnessPolicy(file) {
  if (ARCHIVES.test(file) || REFERENCE.has(file) || MONITORS.has(file)) return null;
  if (/odds|market_lines/.test(file)) return { maxAgeSeconds: 1200 };
  if (/live_game|games_live|live_hr_tracker|global_live_alerts/.test(file)) return { maxAgeSeconds: 120 };
  if (/history|baselines|usage_baselines|power_profiles|pitch_type_damage/.test(file)) return { maxAgeSeconds: 93600 };
  return { maxAgeSeconds: 3600 };
}

export function checkDataFreshness(file, payload, { now = Date.now(), health = null } = {}) {
  const policy = freshnessPolicy(file);
  if (!policy) return { available: true, status: "reference_or_history" };
  const reasons = [];
  const reportedSport = String(payload?.sport || '').toLowerCase();
  const sport = file.match(/^(mlb|nba|wnba|nfl|cfb|nhl)_/)?.[1] || (reportedSport === 'ncaaf' ? 'cfb' : reportedSport);
  if (['mlb', 'nba', 'wnba', 'nfl', 'cfb', 'nhl'].includes(sport)) {
    const expected = currentSeasonStart(sport, now);
    const seasons = [payload?.season, payload?.historySeason, ...(payload?.seasons || []), ...(payload?.historicalSeasons || [])]
      .filter(value => value != null).map(seasonStart);
    if (seasons.some(value => value === null || value !== expected)) reasons.push('non_current_season');
    if (/previous|prior|historical/.test(String(payload?.baselineMode || ''))) reasons.push('historical_baseline_for_live_picks');
    if (/^(nba_history|nfl_usage_baselines|wnba_(?:player|team)_baselines|nhl_board|cfb_board)\.json$/.test(file) && !seasons.length) reasons.push('missing_season_evidence');
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const slate = payload?.date || payload?.slateDate || payload?.pitcherDate;
  if (slate && /^\d{4}-\d{2}-\d{2}$/.test(slate) && slate !== today) reasons.push("wrong_slate_date");
  if (payload?.stale || payload?.preservedAt || payload?.preserveReason) reasons.push("preserved_or_stale_source");
  if (/unavailable|failed|error/.test(String(payload?.availability || payload?.status || ""))) reasons.push("source_unavailable");
  if (payload?.error || Number(payload?.errorCount) > 0 || payload?.errors?.length) reasons.push("source_errors");
  const timestamps = ["dataAsOf", "sourceFetchedAt", "retrievedAt", "fetchedAt", "updatedAt", "updated_at", "generatedAt", "feedTimestamp"]
    .filter(key => payload?.[key] !== undefined && payload[key] !== null)
    .map(key => ({ field: key, value: payload[key] }));
  // Preserve provider observation times carried inside sources and market rows.
  // A newer board envelope must not conceal an old quote or upstream snapshot.
  const nestedTimeFields = new Set(['dataAsOf', 'sourceFetchedAt', 'sourceUpdatedAt', 'providerUpdatedAt', 'quotedAt', 'retrievedAt']);
  function sourceTimes(value, prefix = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['archive','history','snapshots','results','settled'].includes(key)) continue;
      const field = prefix ? `${prefix}.${key}` : key;
      if (prefix && nestedTimeFields.has(key) && child != null) timestamps.push({ field, value: child, ...(/quotedAt$/.test(field) ? { maxAgeSeconds: Math.min(policy.maxAgeSeconds, 1200) } : {}) });
      else if (child && typeof child === 'object') sourceTimes(child, field);
    }
  }
  sourceTimes(payload);
  // Legacy MLB arrays have no envelope. The refresh validator records their
  // rebuild time in the health receipt; that receipt must itself still be valid.
  if (!timestamps.length && Array.isArray(payload)) {
    const artifact = Object.values(health?.artifacts || {}).find(row => row.file === file);
    const expiry = Date.parse(health?.monitoring?.freshUntil);
    if (health?.status === "healthy" && health?.slateDate === today && expiry > now && artifact?.freshness === "current") {
      timestamps.push({ field: "health_receipt", value: artifact.timestamp });
    }
  }
  if (!timestamps.length) reasons.push("missing_source_timestamp");
  for (const { value, maxAgeSeconds = policy.maxAgeSeconds } of timestamps) {
    const time = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(time)) reasons.push("invalid_source_timestamp");
    else if (time > now + 1000) reasons.push("future_source_timestamp");
    else if (now - time >= maxAgeSeconds * 1000) reasons.push("expired_source_timestamp");
  }
  return {
    available: !reasons.length,
    status: reasons.length ? "unavailable" : "current",
    reasons: [...new Set(reasons)],
    timestamps,
    maxAgeSeconds: policy.maxAgeSeconds
  };
}
