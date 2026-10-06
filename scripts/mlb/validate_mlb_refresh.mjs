import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RESULT_EVENT_CATEGORIES } from "./result_event_categories.mjs";
import { isFreshForRefresh, validHealthFreshnessWindow } from "./refresh_freshness.mjs";
import { dataQualityPenaltyIssue } from "./lib/data_quality_confidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA = path.join(__dirname, "../../website/data");
const MAX_REFRESH_AGE_MS = 15 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 1000;
const requestedRefreshStart = Number(process.env.MLB_REFRESH_STARTED_AT);
const refreshStartedAt = Number.isFinite(requestedRefreshStart) && requestedRefreshStart > 0
  ? requestedRefreshStart
  : null;

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
}

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function easternDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function fail(msg) {
  console.error("MLB VALIDATION FAILED:", msg);
  process.exit(1);
}

function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function filePath(file) {
  return path.join(DATA, file);
}

function validateSlateDate(file, field, expected) {
  const payload = read(file);
  const actual = payload?.[field];
  if (actual !== expected) {
    fail(`${file} ${field} is ${actual || "missing"}, expected ${expected}`);
  }
}

function validateCurrentOutput(file, anchor, timestampFields = []) {
  const fullPath = filePath(file);

  if (!fs.existsSync(fullPath)) fail(`${file} does not exist`);

  const stat = fs.statSync(fullPath);
  if (stat.mtimeMs < anchor - CLOCK_TOLERANCE_MS) {
    fail(`${file} was not rebuilt after the current slate refresh began`);
  }

  if (!timestampFields.length) return stat.mtimeMs;

  const payload = read(file);
  const field = timestampFields.find(name => payload?.[name]);
  if (!field) fail(`${file} is missing ${timestampFields.join(" or ")}`);

  const timestamp = Date.parse(payload[field]);
  if (!Number.isFinite(timestamp)) fail(`${file} has invalid ${field}`);
  if (timestamp < anchor - CLOCK_TOLERANCE_MS) {
    fail(`${file} contains stale ${field}: ${payload[field]}`);
  }

  return stat.mtimeMs;
}

function validateDependencyOrder(times, before, after) {
  if (times.get(before) > times.get(after)) {
    fail(`${before} was written after dependent output ${after}`);
  }
}

function validateVerifiedPregameReceipts() {
  const payload = read("hr_ai_history.json");
  const history = payload?.history;
  if (!history || typeof history !== "object" || Array.isArray(history)) {
    fail("hr_ai_history.json has an invalid history object");
  }

  let verifiedCount = 0;
  for (const snapshots of Object.values(history)) {
    if (!Array.isArray(snapshots)) fail("hr_ai_history.json contains a non-array player history");

    for (const receipt of snapshots) {
      if (receipt?.verifiedPregame !== true) continue;
      verifiedCount++;

      const snapshotAt = Date.parse(receipt.snapshotAt || receipt.timestamp);
      const gameStartTime = Date.parse(receipt.gameStartTime);
      const expectedId = `${receipt.slateDate}|${receipt.gamePk}|${receipt.playerId}`;
      if (!receipt.slateDate || !Number(receipt.gamePk) || !Number(receipt.playerId)) {
        fail("Verified HR receipt is missing its canonical game/player identity");
      }
      if (receipt.receiptId !== expectedId) {
        fail(`Verified HR receipt has invalid receiptId ${receipt.receiptId || "missing"}`);
      }
      if (!Number.isFinite(snapshotAt) || !Number.isFinite(gameStartTime) || snapshotAt >= gameStartTime) {
        fail(`Verified HR receipt ${receipt.receiptId} was not captured before first pitch`);
      }
      if (!receipt.modelVersion || receipt.verificationStatus !== "verified_before_first_pitch") {
        fail(`Verified HR receipt ${receipt.receiptId} is missing model verification metadata`);
      }
      if (receipt.probability !== null && receipt.probability !== undefined) {
        const probability = Number(receipt.probability);
        if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
          fail(`Verified HR receipt ${receipt.receiptId} has invalid probability`);
        }
      }
    }
  }

  if (Number(payload?.verification?.verifiedReceiptCount) !== verifiedCount) {
    fail("hr_ai_history.json verified receipt count does not match stored receipts");
  }
  const coverage = payload?.verification?.currentSlateAnalysis;
  if (!coverage || !Array.isArray(coverage.expectedGamePks)
    || !Array.isArray(coverage.capturedGamePks) || !Array.isArray(coverage.missingGamePks)) {
    fail("hr_ai_history.json is missing current slate analysis coverage");
  }
  if (coverage.missingGamePks.length || coverage.complete !== true) {
    fail(`hr_ai_history.json is missing verified pregame coverage for analysis gamePks: ${coverage.missingGamePks.join(", ")}`);
  }
}

function validateCalibrationReport() {
  const report = read("hr_calibration_report.json");
  if (report?.schemaVersion !== "2.0" || report?.verification?.join !== "slateDate+gamePk+playerId") {
    fail("hr_calibration_report.json is not using the verified receipt schema");
  }

  for (const window of ["7d", "30d", "season"]) {
    const metrics = report?.windows?.[window];
    if (!metrics) fail(`hr_calibration_report.json is missing ${window} metrics`);
    const predictions = Number(metrics.predictions);
    const hits = Number(metrics.hits);
    if (!Number.isInteger(predictions) || !Number.isInteger(hits) || predictions < 0 || hits < 0 || hits > predictions) {
      fail(`hr_calibration_report.json has invalid ${window} counts`);
    }
  }

  if (Number(report?.summary?.fullBoard?.predictions) !== Number(report?.windows?.season?.predictions)) {
    fail("hr_calibration_report.json season summary is inconsistent");
  }
}

function validateMarketOdds(expectedDate) {
  const payload = read("mlb_market_odds.json");
  const validAvailability = new Set(["available", "partial", "unavailable", "no_games_scheduled"]);
  const pool = read("mlb_player_pool.json");
  const currentPlayers = new Set(
    (pool.players || []).map(player => `${Number(player.gamePk)}|${Number(player.playerId)}`)
  );

  if (payload?.schemaVersion !== "1.0") fail("mlb_market_odds.json has an invalid schemaVersion");
  if (!["The Odds API", "PropLine"].includes(payload?.source) || payload?.market !== "batter_home_runs") {
    fail("mlb_market_odds.json has invalid provider or market metadata");
  }
  if (payload?.date !== expectedDate) {
    fail(`mlb_market_odds.json date is ${payload?.date || "missing"}, expected ${expectedDate}`);
  }
  if (!validAvailability.has(payload?.availability)) {
    fail(`mlb_market_odds.json has invalid availability ${payload?.availability || "missing"}`);
  }
  if (!Array.isArray(payload?.events) || !Array.isArray(payload?.prices) || !Array.isArray(payload?.rejections)) {
    fail("mlb_market_odds.json must contain events, prices, and rejections arrays");
  }
  if (payload?.policy?.staleQuotesRetained !== false || payload?.policy?.unmatchedPlayersRetained !== false) {
    fail("mlb_market_odds.json does not enforce strict stale/unmatched quote rejection");
  }
  if (["unavailable", "no_games_scheduled"].includes(payload.availability) && payload.prices.length) {
    fail(`mlb_market_odds.json retained prices while ${payload.availability}`);
  }
  if (["available", "partial"].includes(payload.availability) && !payload.prices.length) {
    fail(`mlb_market_odds.json is ${payload.availability} without verified prices`);
  }

  const generatedAt = Date.parse(payload.generatedAt);
  if (!Number.isFinite(generatedAt)) {
    fail("mlb_market_odds.json has an invalid generatedAt timestamp");
  }

  const maxAgeMs = Number(payload?.policy?.maxQuoteAgeMinutes) * 60 * 1000;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > MAX_REFRESH_AGE_MS) {
    fail("mlb_market_odds.json has an invalid quote-age policy");
  }

  const quoteIds = new Set();
  for (const quote of payload.prices) {
    if (!quote?.quoteId || quoteIds.has(quote.quoteId)) {
      fail(`mlb_market_odds.json contains a missing or duplicate quoteId ${quote?.quoteId || "missing"}`);
    }
    quoteIds.add(quote.quoteId);

    const identity = `${Number(quote.gamePk)}|${Number(quote.playerId)}`;
    if (!currentPlayers.has(identity)) {
      fail(`mlb_market_odds.json quote ${quote.quoteId} is not joined to the current canonical slate`);
    }
    if (quote.date !== expectedDate || quote.market !== "batter_home_runs" || Number(quote.point) !== 0.5) {
      fail(`mlb_market_odds.json quote ${quote.quoteId} has invalid slate or market identity`);
    }
    const updatedAt = Date.parse(quote.providerLastUpdate);
    if (!Number.isFinite(updatedAt) || generatedAt - updatedAt > maxAgeMs || updatedAt > generatedAt + 60000) {
      fail(`mlb_market_odds.json quote ${quote.quoteId} is stale or has an invalid provider timestamp`);
    }
    for (const field of ["modelProbability", "impliedProbability"]) {
      const value = Number(quote[field]);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        fail(`mlb_market_odds.json quote ${quote.quoteId} has invalid ${field}`);
      }
    }
    for (const field of ["overPriceAmerican", "rawEdge", "expectedValue"]) {
      if (!Number.isFinite(Number(quote[field]))) {
        fail(`mlb_market_odds.json quote ${quote.quoteId} has invalid ${field}`);
      }
    }
    for (const field of ["noVigProbability", "noVigEdge", "underPriceAmerican"]) {
      if (quote[field] !== null && !Number.isFinite(Number(quote[field]))) {
        fail(`mlb_market_odds.json quote ${quote.quoteId} has invalid ${field}`);
      }
    }
  }
}

function validateLiveChangeAlerts(expectedDate) {
  const payload = read("live_change_alerts.json");
  const validStatuses = new Set(["baseline_established", "ready", "no_games_scheduled"]);

  if (payload?.schemaVersion !== "1.0") fail("live_change_alerts.json has an invalid schemaVersion");
  if (payload?.date !== expectedDate) fail(`live_change_alerts.json date is ${payload?.date || "missing"}, expected ${expectedDate}`);
  if (!validStatuses.has(payload?.status)) fail(`live_change_alerts.json has invalid status ${payload?.status || "missing"}`);
  if (!Array.isArray(payload?.alerts)) fail("live_change_alerts.json alerts must be an array");
  if (!payload?.snapshot || typeof payload.snapshot !== "object" || Array.isArray(payload.snapshot)) {
    fail("live_change_alerts.json has an invalid snapshot");
  }

  const ids = new Set();
  for (const alert of payload.alerts) {
    const required = ["id", "kind", "entityType", "entityId", "entityName", "date", "sport", "createdAt"];
    for (const field of required) {
      if (alert?.[field] === undefined || alert?.[field] === null || alert?.[field] === "") {
        fail(`live_change_alerts.json alert is missing ${field}`);
      }
    }
    if (alert.date !== expectedDate || alert.sport !== "MLB") fail(`live_change_alerts.json alert ${alert.id} has invalid slate identity`);
    if (ids.has(alert.id)) fail(`live_change_alerts.json contains duplicate alert ${alert.id}`);
    ids.add(alert.id);
  }
}

function validatePlayerCardSignals() {
  const payload = read("player_card_data.json");
  const players = Array.isArray(payload.players) ? payload.players : [];
  const schedule = read("mlb_games_today.json");
  const noGamesScheduled = schedule.date === todayET()
    && Array.isArray(schedule.games)
    && schedule.games.length === 0;

  if (!players.length) {
    if (noGamesScheduled) return;
    fail("player_card_data.json has no players");
  }

  for (const player of players) {
    if (!Array.isArray(player.slateSignals)) {
      fail(`player_card_data.json is missing slateSignals for ${player.player || "unknown player"}`);
    }

    const keys = new Set(player.slateSignals.map(signal => signal?.key));
    const confidence = num(player.model?.score);
    const pitchEdge = num(player.model?.pitchEdge);
    const barrelScore = num(player.model?.barrelScore);
    const hardHitScore = num(player.model?.hardHitScore);
    const recentHr = num(player.last7?.hr);

    const expected = {
      hotLook: confidence >= 52,
      hotLately: recentHr >= 2,
      due: barrelScore >= 80 && hardHitScore >= 75 && recentHr === 0,
      sleeper: confidence >= 42 && confidence < 52 && pitchEdge >= 55 && recentHr === 0
    };

    for (const [key, active] of Object.entries(expected)) {
      if (keys.has(key) !== active) {
        fail(`player_card_data.json has an invalid ${key} signal for ${player.player || "unknown player"}`);
      }
    }
  }
}

function validatePlayerResultEvents() {
  const payload = read("mlb_results.json");

  if (!Array.isArray(payload.homeRuns)) {
    fail("mlb_results.json has an invalid homeRuns array");
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "playerEvents")) return;
  if (!Array.isArray(payload.playerEvents)) {
    fail("mlb_results.json has an invalid playerEvents array");
  }

  const allowedCategories = new Set(RESULT_EVENT_CATEGORIES);

  for (const event of payload.playerEvents) {
    const label = event.player || event.batter || "unknown player";
    if (!event.playerId || !String(label).trim()) {
      fail(`mlb_results.json has an event without a player identity for ${label}`);
    }
    if (!allowedCategories.has(event.category)) {
      fail(`mlb_results.json has an invalid event category for ${label}`);
    }
    if (typeof event.isCloseCall !== "boolean") {
      fail(`mlb_results.json has an invalid close-call flag for ${label}`);
    }
    if (event.isCloseCall) {
      const distance = Number(event.distance);
      if (event.category === "home_run" || !Number.isFinite(distance) || distance < 350) {
        fail(`mlb_results.json has an unsupported close-call classification for ${label}`);
      }
    }
  }
}

function validatePitchDamageCache(expectedDate) {
  const pool = read("mlb_player_pool.json");
  const cache = read("pitch_type_damage_cache.json");
  const damage = read("pitch_type_damage.json");
  const players = Array.isArray(pool.players) ? pool.players : [];

  if (!cache.players || typeof cache.players !== "object" || Array.isArray(cache.players)) {
    fail("pitch_type_damage_cache.json has an invalid players object");
  }

  if (!damage.players || typeof damage.players !== "object" || Array.isArray(damage.players)) {
    fail("pitch_type_damage.json has an invalid players object");
  }

  const playerNamesById = new Map();

  for (const player of players) {
    const playerId = String(player.playerId || player.mlbId || player.id || "").trim();
    const playerName = String(player.player || "").trim();
    if (!playerId || !playerName) fail("Current player pool contains a player without a name or MLB ID");

    const existingName = playerNamesById.get(playerId);
    if (existingName && existingName !== playerName) {
      fail(`Current player pool has conflicting names for MLB ID ${playerId}: ${existingName}, ${playerName}`);
    }
    playerNamesById.set(playerId, playerName);

    const cached = cache.players[`${playerId}|${expectedDate.slice(0, 4)}`];
    if (!cached || easternDate(cached.cached_at) !== expectedDate) {
      fail(`Pitch damage cache is not current for ${playerName}`);
    }

    const damageRow = damage.players[playerId];
    if (!damageRow || String(damageRow.playerId || "") !== playerId || String(damageRow.player || "") !== playerName) {
      fail(`pitch_type_damage.json is missing the ID-keyed record for ${playerName} (${playerId})`);
    }
  }

  if (Object.keys(damage.players).length !== playerNamesById.size) {
    fail(`pitch_type_damage.json has ${Object.keys(damage.players).length} players; expected ${playerNamesById.size}`);
  }
}

function validateHealthStatus(expectedDate, anchor) {
  const health = read("health_status.json");
  const updatedAt = Date.parse(health.updatedAt);
  const generatedAt = Date.parse(health.generatedAt);
  const games = read("mlb_games_today.json");
  const noGamesScheduled = games.date === expectedDate
    && Array.isArray(games.games)
    && games.games.length === 0;
  const expectedLabel = noGamesScheduled ? "CLOSED" : "LIVE";

  if (health.status !== "healthy" || health.label !== expectedLabel) {
    fail(`health_status.json is not healthy: ${(health.errors || []).join(" | ") || "unknown error"}`);
  }

  if (noGamesScheduled && health.availability !== "no_games_scheduled") {
    fail("health_status.json does not declare the verified no-games state");
  }

  if (health.source !== "mlb_fast_refresh") {
    fail(`health_status.json has unexpected source ${health.source || "missing"}`);
  }

  if (health.slateDate !== expectedDate) {
    fail(`health_status.json monitoring slate is ${health.slateDate || "missing"}; expected ${expectedDate}`);
  }

  const monitoring = health.monitoring || {};
  const expectedState = noGamesScheduled ? "closed" : "live";
  const checkedAt = Date.parse(monitoring.checkedAt);
  const lastSuccessfulAt = Date.parse(monitoring.lastSuccessfulAt);
  const freshUntil = Date.parse(monitoring.freshUntil);
  if (monitoring.state !== expectedState) {
    fail(`health_status.json monitoring state is ${monitoring.state || "missing"}; expected ${expectedState}`);
  }
  if (!Number.isFinite(generatedAt) || checkedAt !== generatedAt || lastSuccessfulAt !== generatedAt) {
    fail("health_status.json monitoring timestamps do not identify the completed refresh");
  }
  const artifactDeadlines = Object.values(health.artifacts || {})
    .filter(artifact => artifact?.required === true)
    .map(artifact => Date.parse(artifact.timestamp) + Number(artifact.maxAgeSeconds) * 1000);
  if (monitoring.refreshWindowSeconds !== 900 || !validHealthFreshnessWindow({
    generatedAt,
    freshUntil,
    refreshWindowMs: MAX_REFRESH_AGE_MS,
    artifactDeadlines
  })) {
    fail("health_status.json monitoring freshness window is invalid");
  }

  const requiredArtifacts = ["games", "playerPool", "hrBoard", "matchups", "decision", "weather"];
  for (const key of requiredArtifacts) {
    const artifact = health.artifacts?.[key];
    if (!artifact || artifact.required !== true || artifact.freshness !== "current") {
      fail(`health_status.json has invalid monitoring metadata for ${key}`);
    }
    if (!artifact.file || !Number.isFinite(Date.parse(artifact.timestamp)) || !Number.isFinite(artifact.ageSeconds)) {
      fail(`health_status.json has incomplete artifact monitoring metadata for ${key}`);
    }
  }

  if (!Number.isFinite(updatedAt) || updatedAt < anchor - CLOCK_TOLERANCE_MS) {
    fail("health_status.json updatedAt does not belong to the current refresh");
  }

  if (games.date !== expectedDate) fail(`Health status is not tied to the ${expectedDate} slate`);
}

function validatePitcherVulnerability(expectedDate) {
  const matchups = read("game_pitcher_matchups.json");
  const payload = read("pitcher_vulnerability.json");
  const rows = Array.isArray(payload.pitchers) ? payload.pitchers : [];
  const expectedCount = (matchups.games || []).length * 2;
  const baseline = Number(payload.liveSlateMedian);

  if (payload.date !== expectedDate || payload.source !== "MLB Stats API live season pitching") {
    fail("pitcher_vulnerability.json has stale date or non-live source provenance");
  }
  if (payload.scale !== "0-100 risk index; not a probability") {
    fail("pitcher_vulnerability.json does not declare the canonical risk-index scale");
  }
  if (rows.length !== expectedCount || Number(payload.count) !== expectedCount) {
    fail(`pitcher_vulnerability.json has ${rows.length} pitchers; expected ${expectedCount}`);
  }
  if (!Number.isFinite(baseline)) fail("pitcher_vulnerability.json is missing its live-slate median");

  const byId = new Map();
  for (const row of rows) {
    const id = String(row.id || "");
    const available = row.available !== false;
    const score = Number(row.vulnerability);
    const raw = Number(row.vulnerabilityRaw);
    const weight = Number(row.vulnerabilitySampleWeight);
    const innings = Number(row.vulnerabilityTrueInnings);
    if (!id || byId.has(id)) fail(`pitcher_vulnerability.json has a missing or duplicate pitcher ID ${id || "unknown"}`);
    if (!available) {
      if (!["pending", "updating"].includes(row.status) || row.vulnerability !== null || row.stats !== null) {
        fail(`Unavailable pitcher ${row.pitcher || id} must be marked pending/updating without invented stats or risk`);
      }
      byId.set(id, null);
      continue;
    }
    if (!Number.isFinite(score) || score < 12 || score > 98) fail(`Invalid risk index for ${row.pitcher || id}`);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) fail(`Invalid raw risk index for ${row.pitcher || id}`);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1) fail(`Invalid sample weight for ${row.pitcher || id}`);
    if (!Number.isFinite(innings) || innings <= 0) fail(`Invalid true innings for ${row.pitcher || id}`);
    if (Math.abs(weight - Math.min(1, innings / 60)) > 0.001) fail(`Sample weight does not match live innings for ${row.pitcher || id}`);
    if (Math.abs(score - baseline) > Math.abs(raw - baseline) + 1) fail(`Short-sample stabilization moved ${row.pitcher || id} away from the live baseline`);
    byId.set(id, score);
  }

  for (const game of matchups.games || []) {
    for (const side of ["away", "home"]) {
      const pitcher = game[`${side}Pitcher`] || {};
      const id = String(pitcher.id || "");
      const expected = byId.get(id);
      if (!byId.has(id) || (expected === null
        ? pitcher.available !== false || !["pending", "updating"].includes(pitcher.status) || pitcher.vulnerability !== null
        : Number(pitcher.vulnerability) !== expected)) {
        fail(`${game.matchup || game.game} has a non-canonical ${side} pitcher risk index`);
      }
    }
  }
}

function inningsToNumber(value) {
  const match = String(value ?? "").trim().match(/^(\d+)(?:\.([012]))?$/);
  if (!match) return 0;
  return Number(match[1]) + Number(match[2] || 0) / 3;
}

function validatePitcherRateFields() {
  const matchups = read("game_pitcher_matchups.json");
  const required = ["kPer9", "bbPer9", "hPer9", "hrPer9"];

  for (const game of matchups.games || []) {
    for (const side of ["away", "home"]) {
      const pitcher = game[`${side}Pitcher`] || {};
      if (pitcher.available === false) continue;
      const stats = pitcher.stats || {};
      const innings = inningsToNumber(stats.inningsPitched);
      if (innings <= 0) fail(`${pitcher.pitcher || pitcher.name || "Pitcher"} has invalid innings for rate validation`);

      const expected = {
        kPer9: Number(((num(stats.strikeOuts) / innings) * 9).toFixed(2)),
        bbPer9: Number(((num(stats.walks) / innings) * 9).toFixed(2)),
        hPer9: Number(((num(stats.hits) / innings) * 9).toFixed(2)),
        hrPer9: Number(((num(stats.homeRuns) / innings) * 9).toFixed(2))
      };

      for (const field of required) {
        if (!Number.isFinite(Number(stats[field])) || Math.abs(Number(stats[field]) - expected[field]) > 0.001) {
          fail(`${pitcher.pitcher || pitcher.name || "Pitcher"} has an invalid derived ${field}`);
        }
      }
    }
  }
}

function confirmedPitcherIdForStatcast(game, side) {
  const profile = game[`${side}Pitcher`] || {};
  const pitcherId = profile.id || profile.playerId || game[`${side}ProbablePitcherId`];
  const pitcher = clean(profile.name || profile.pitcher || game[`${side}ProbablePitcher`] || "");

  if (profile.available === false || !pitcherId || !pitcher || pitcher === "TBD") {
    return null;
  }

  return String(pitcherId);
}

function validateRealStatcastZones(expectedDate) {
  const pool = read("mlb_player_pool.json");
  const matchups = read("game_pitcher_matchups.json");
  const statcast = read("statcast_zones.json");
  const players = Array.isArray(pool.players) ? pool.players : [];
  const pitcherIds = new Set();

  for (const game of matchups.games || []) {
    for (const side of ["away", "home"]) {
      const pitcherId = confirmedPitcherIdForStatcast(game, side);
      if (pitcherId) pitcherIds.add(pitcherId);
    }
  }

  if (statcast.source !== "baseball_savant_statcast_pitch_detail_csv") {
    fail(`statcast_zones.json has non-Statcast source ${statcast.source || "missing"}`);
  }

  if (statcast.date !== expectedDate) {
    fail(`statcast_zones.json date is ${statcast.date || "missing"}; expected ${expectedDate}`);
  }

  if (!statcast.players || Object.keys(statcast.players).length !== players.length) {
    fail(`statcast_zones.json does not contain exactly ${players.length} current players`);
  }

  let playersWithRows = 0;
  let playersWithZones = 0;

  for (const player of players) {
    const row = statcast.players[String(player.playerId || player.mlbId || player.id)] || statcast.players[player.player];
    if (!row || String(row.playerId || row.mlbId || "") !== String(player.playerId || player.mlbId || player.id)) {
      fail(`statcast_zones.json is missing the current row for ${player.player}`);
    }
    if (easternDate(row.cached_at) !== expectedDate) {
      fail(`Statcast zones are not current for ${player.player}`);
    }

    for (const metric of ["avg", "iso", "slg", "xwoba", "hr", "k", "hardHit", "barrel", "raw"]) {
      if (!Array.isArray(row.zones?.[metric]) || row.zones[metric].length !== 25) {
        fail(`Statcast ${metric} zones are invalid for ${player.player}`);
      }
    }

    const recent = row.recentForm;
    if (recent?.schemaVersion !== "1.0" || !["last7", "last15", "last30", "season"].every(key => recent[key])) {
      fail(`Statcast recent form is invalid for ${player.player}`);
    }
    if (Number(recent.reliability) < 0 || Number(recent.reliability) > 1 || Math.abs(Number(recent.modelAdjustment)) > 2.5) {
      fail(`Statcast recent form adjustment is unsafe for ${player.player}`);
    }

    const rawPitchCount = row.zones.raw.reduce((sum, cell) => sum + Number(cell?.pitches || 0), 0);
    if (rawPitchCount !== Number(row.zonePitchCount || 0)) {
      fail(`Statcast raw pitch count does not match zonePitchCount for ${player.player}`);
    }
    if (Number(row.rows) > 0) playersWithRows++;
    if (Number(row.zonePitchCount) > 0) playersWithZones++;
  }

  if (Number(statcast.playerCount) !== players.length) fail("Statcast playerCount does not match current pool");
  if (Number(statcast.playersWithRows) !== playersWithRows) fail("Statcast playersWithRows is incorrect");
  if (Number(statcast.playersWithZones) !== playersWithZones) fail("Statcast playersWithZones is incorrect");

  if (!statcast.pitchers || Object.keys(statcast.pitchers).length !== pitcherIds.size) {
    fail(`statcast_zones.json does not contain exactly ${pitcherIds.size} current pitchers`);
  }

  let pitchersWithRows = 0;
  let pitchersWithZones = 0;

  for (const pitcherId of pitcherIds) {
    const row = statcast.pitchers[pitcherId];
    if (!row || String(row.pitcherId || row.playerId || row.mlbId || "") !== pitcherId) {
      fail(`statcast_zones.json is missing current pitcher ${pitcherId}`);
    }
    if (easternDate(row.cached_at) !== expectedDate) {
      fail(`Statcast pitcher zones are not current for ${row.pitcher || pitcherId}`);
    }

    for (const metric of ["avg", "iso", "slg", "xwoba", "hr", "k", "hardHit", "barrel", "raw"]) {
      if (!Array.isArray(row.zones?.[metric]) || row.zones[metric].length !== 25) {
        fail(`Statcast pitcher ${metric} zones are invalid for ${row.pitcher || pitcherId}`);
      }
    }

    const rawPitchCount = row.zones.raw.reduce((sum, cell) => sum + Number(cell?.pitches || 0), 0);
    if (rawPitchCount !== Number(row.zonePitchCount || 0)) {
      fail(`Statcast pitcher raw pitch count does not match for ${row.pitcher || pitcherId}`);
    }
    const hasRealSample = Number(row.rows) > 0 && Number(row.zonePitchCount) > 0;
    const markedNoSample = row.source === "no_real_statcast_sample" && Number(row.zonePitchCount) === 0;
    if (!hasRealSample && !markedNoSample) {
      fail(`Statcast pitcher zones have no real sample for ${row.pitcher || pitcherId}`);
    }
    if (Number(row.rows) > 0) pitchersWithRows++;
    if (Number(row.zonePitchCount) > 0) pitchersWithZones++;
  }

  if (Number(statcast.pitcherCount) !== pitcherIds.size) fail("Statcast pitcherCount is incorrect");
  if (Number(statcast.pitchersWithRows) !== pitchersWithRows) fail("Statcast pitchersWithRows is incorrect");
  if (Number(statcast.pitchersWithZones) !== pitchersWithZones) fail("Statcast pitchersWithZones is incorrect");
}

function validateRealPitcherAttackZones(expectedDate) {
  const hr = read("mlb_home_runs.json");
  const matchups = read("game_pitcher_matchups.json");
  const statcast = read("statcast_zones.json");
  const attack = read("pitcher_attack_zones.json");
  const decision = read("hr_decision_center.json");
  const matchupByPlayerId = new Map();

  for (const game of matchups.games || []) {
    for (const side of ["away", "home"]) {
      const pitcher = side === "away" ? game.homePitcher : game.awayPitcher;
      const pitcherId = pitcher?.id || pitcher?.playerId || "";
      const pitcherName = clean(pitcher?.name || pitcher?.pitcher || "");
      const pending = pitcher?.available === false || !pitcherId || !pitcherName || pitcherName === "TBD";
      for (const hitter of game.hitters?.[side] || []) {
        if (hitter.playerId) {
          matchupByPlayerId.set(String(hitter.playerId), {
            pitcherId: pending ? "" : String(pitcherId),
            pending
          });
        }
      }
    }
  }

  if (attack.source !== "baseball_savant_hitter_pitcher_zone_overlap") {
    fail(`pitcher_attack_zones.json has non-Statcast source ${attack.source || "missing"}`);
  }
  if (attack.date !== expectedDate || attack.statcastSource !== statcast.source) {
    fail("pitcher_attack_zones.json has stale date or source provenance");
  }
  if (!attack.players || Object.keys(attack.players).length !== hr.length) {
    fail(`pitcher_attack_zones.json does not contain exactly ${hr.length} players`);
  }

  if (!Array.isArray(decision.allPlayers)) fail("Decision Center is missing allPlayers rows");

  const decisionByPlayer = new Map();
  for (const row of decision.allPlayers || []) {
    if (row.playerId) decisionByPlayer.set(String(row.playerId), row);
    if (row.player) decisionByPlayer.set(row.player, row);
    const exposure = row.pitchingExposure;
    const expectedPa = Number(row.projectedPlateAppearances || 0);
    if (!exposure || Math.abs(Number(exposure.starterPlateAppearances) + Number(exposure.bullpenPlateAppearances) - expectedPa) > 0.011) {
      fail(`Decision Center has invalid pitching exposure for ${row.player}`);
    }
    if (expectedPa === 0) {
      if (Number(exposure.blendedPitchingRisk) !== 0) fail(`Inactive player has pitching exposure for ${row.player}`);
    } else if (Number(exposure.starterShare) !== 0.58 || Number(exposure.bullpenShare) !== 0.42) {
      fail(`Decision Center has invalid pitching exposure shares for ${row.player}`);
    }
    const quality = row.dataQuality;
    const rawConfidence = Number(row.rawModelConfidence);
    const adjustedConfidence = Number(row.hrConfidence);
    if (!quality || Number(quality.score) < 0 || Number(quality.score) > 100) {
      fail(`Decision Center has invalid data quality for ${row.player}`);
    }
    const penaltyIssue = dataQualityPenaltyIssue(rawConfidence, adjustedConfidence, quality);
    if (penaltyIssue) fail(`Decision Center has unsafe data quality penalty for ${row.player}: ${penaltyIssue} (raw=${rawConfidence}, adjusted=${adjustedConfidence}, factor=${quality.penaltyFactor})`);
    const movement = row.movement;
    if (!movement || !["NEW", "UP", "DOWN", "UNCHANGED"].includes(movement.direction) || !Array.isArray(movement.reasons)) {
      fail(`Decision Center has invalid movement for ${row.player}`);
    }
    if (movement.status !== "INITIAL_SNAPSHOT") {
      const expectedDelta = Math.round((Number(movement.currentConfidence) - Number(movement.previousConfidence)) * 10) / 10;
      if (Math.abs(expectedDelta - Number(movement.confidenceDelta)) > 0.01 || Number(movement.currentConfidence) !== adjustedConfidence) {
        fail(`Decision Center movement delta is invalid for ${row.player}`);
      }
    }
    for (const reason of movement.reasons) {
      if (!reason?.key || !reason?.label || !["support", "risk", "neutral"].includes(reason.impact)) {
        fail(`Decision Center has invalid movement reason for ${row.player}`);
      }
    }
    const ownership = row.ownershipVerification;
    if (ownership?.status !== "VERIFIED" || String(ownership.playerId) !== String(row.playerId) || String(ownership.teamId) !== String(row.teamId)) {
      fail(`Decision Center has invalid ownership verification for ${row.player}`);
    }
  }
  for (const player of hr) {
    if (!decisionByPlayer.has(String(player.playerId))) {
      fail(`Decision Center is missing current player ID for ${player.player}`);
    }
  }
  const roundTo = (value, places = 2) => {
    const mult = 10 ** places;
    return Math.round(Number(value) * mult) / mult;
  };
  const overallXwoba = (raw, requireSamples = true) => {
    const total = raw.reduce((sum, cell) => sum + Number(cell?.xwobaTotal || 0), 0);
    const count = raw.reduce((sum, cell) => sum + Number(cell?.xwobaCount || 0), 0);
    if (!count && requireSamples) fail("Real attack-zone validation found a pitcher without xwOBA samples");
    return count ? total / count : null;
  };

  for (const player of hr) {
    const row = attack.players[String(player.playerId)] || attack.players[player.player];
    const matchup = matchupByPlayerId.get(String(player.playerId)) || {};
    const pitcherId = matchup.pitcherId || "";
    const hitterCard = statcast.players?.[String(player.playerId)] || statcast.players?.[player.player];
    const pitcherCard = statcast.pitchers?.[pitcherId];
    const decisionRow = decisionByPlayer.get(String(player.playerId)) || decisionByPlayer.get(player.player);

    if (matchup.pending) {
      if (!row || !hitterCard || row.opposingPitcherPending !== true || row.opposingPitcherId !== null) {
        fail(`Pending attack-zone dependency is not marked for ${player.player}`);
      }
      if (row.zones?.zoneSignalAvailable !== false || row.zones?.pitcherLeak !== null || !Array.isArray(row.zones?.zones) || row.zones.zones.length !== 25) {
        fail(`Pending attack-zone grid is invalid for ${player.player}`);
      }
      if (!decisionRow || decisionRow.zoneOverlap !== null || decisionRow.zoneSignalAvailable !== false || Number(decisionRow.pitcherRisk) !== 0) {
        fail(`Decision Center pending zone fallback is incorrect for ${player.player}`);
      }
      continue;
    }

    if (!row || !pitcherId || !hitterCard || !pitcherCard) {
      fail(`Real attack-zone dependency is missing for ${player.player}`);
    }
    if (String(row.opposingPitcherId) !== pitcherId) {
      fail(`Attack-zone pitcher mapping is incorrect for ${player.player}`);
    }

    const hitterXwoba = overallXwoba(hitterCard.zones.raw, false);
    const hitterOverall = hitterXwoba === null ? null : Math.min(100, hitterXwoba * 100);
    const pitcherXwoba = overallXwoba(pitcherCard.zones.raw, false);
    const pitcherOverall = pitcherXwoba === null ? null : Math.min(100, pitcherXwoba * 100);
    if (hitterOverall === null ? row.zones?.hitterPower !== null : Math.abs(Number(row.zones?.hitterPower) - roundTo(hitterOverall)) > 0.01) {
      fail(`Attack-zone hitter power is incorrect for ${player.player}`);
    }
    if (row.zones?.qualified !== (hitterOverall !== null)) {
      fail(`Attack-zone qualification is incorrect for ${player.player}`);
    }
    if (pitcherOverall === null ? row.zones?.pitcherLeak !== null : Math.abs(Number(row.zones?.pitcherLeak) - roundTo(pitcherOverall)) > 0.01) {
      fail(`Attack-zone pitcher leak is incorrect for ${player.player}`);
    }

    const cells = row.zones?.zones;
    if (!Array.isArray(cells) || cells.length !== 25) fail(`Attack-zone grid is invalid for ${player.player}`);

    let overlapTotal = 0;
    let qualifiedCount = 0;
    let hotCount = 0;

    for (let index = 0; index < 25; index++) {
      const hitterSamples = Number(hitterCard.zones.raw[index]?.xwobaCount || 0);
      const pitcherSamples = Number(pitcherCard.zones.raw[index]?.xwobaCount || 0);
      const qualified = hitterSamples > 0 && pitcherSamples > 0;
      const expectedDanger = qualified
        ? roundTo(Math.max(0, Math.min(100,
          Math.min(Number(hitterCard.zones.xwoba[index]), Number(pitcherCard.zones.xwoba[index])) * 100
        )))
        : null;
      const cell = cells[index];

      if (cell.qualified !== qualified || Number(cell.hitterSamples) !== hitterSamples || Number(cell.pitcherSamples) !== pitcherSamples) {
        fail(`Attack-zone samples are incorrect for ${player.player} zone ${index + 1}`);
      }
      if (expectedDanger === null ? cell.danger !== null : Math.abs(Number(cell.danger) - expectedDanger) > 0.01) {
        fail(`Attack-zone overlap is incorrect for ${player.player} zone ${index + 1}`);
      }
      if (qualified) {
        overlapTotal += expectedDanger;
        qualifiedCount++;
        if (expectedDanger >= 65) hotCount++;
      }
    }

    const expectedScore = qualifiedCount ? roundTo(Math.max(0, Math.min(100,
      roundTo(hitterOverall) * 0.34 + roundTo(pitcherOverall) * 0.34 +
      (overlapTotal / qualifiedCount) * 0.22 + hotCount * 1.8
    ))) : null;
    if (!decisionRow || String(decisionRow.playerId || decisionRow.mlbId || "") !== String(player.playerId)) {
      fail(`Decision Center is missing current player ID for ${player.player}`);
    }
    if (!decisionRow || (expectedScore === null
      ? decisionRow.zoneOverlap !== null || decisionRow.zoneSignalAvailable !== false
      : Math.abs(Number(decisionRow.zoneOverlap) - expectedScore) > 0.01)) {
      fail(`Decision Center zone overlap is incorrect for ${player.player}`);
    }
    const expectedPitcherRisk = expectedScore === null ? (pitcherOverall === null ? 0 : roundTo(pitcherOverall)) : expectedScore;
    if (Math.abs(Number(decisionRow.pitcherRisk) - expectedPitcherRisk) > 0.01) {
      fail(`Decision Center pitcher risk is incorrect for ${player.player}`);
    }
    if (Number(decisionRow.hotZoneCount) !== hotCount) {
      fail(`Decision Center hot-zone count is incorrect for ${player.player}`);
    }
  }
}

const today = todayET();

const games = read("mlb_games_today.json");
const scheduleGames = Array.isArray(games.games) ? games.games : [];
const specialEventSlate = scheduleGames.some(game => game.gameType === "A");
const slateDate = games.date || today;
const refreshAnchor = Date.parse(games.updatedAt);
const noGamesScheduled = games.date === today
  && Array.isArray(games.games)
  && games.games.length === 0;

if (!Number.isFinite(refreshAnchor)) fail("mlb_games_today.json has invalid or missing updatedAt");
if (!isFreshForRefresh({
  timestamp: refreshAnchor,
  generatedAt: Date.now(),
  maxAgeMs: MAX_REFRESH_AGE_MS,
  refreshStartedAt,
  toleranceMs: CLOCK_TOLERANCE_MS
})) {
  fail(`mlb_games_today.json is older than ${MAX_REFRESH_AGE_MS / 60000} minutes`);
}

const currentOutputs = [
  ["mlb_games_today.json", ["updatedAt"]],
  ["mlb_player_pool.json", ["updatedAt"]],
  ["mlb_player_transactions.json", ["updatedAt"]],
  ["hr_power_profiles.json", ["generatedAt"]],
  ["game_pitcher_matchups.json", ["updatedAt"]],
  ["lineup_impact_engine.json", ["updatedAt"]],
  ["pitcher_attack_zones.json", ["updated_at"]],
  ["statcast_zones.json", ["updated_at"]],
  ["pitcher_vulnerability.json", ["updatedAt"]],
  ["mlb_hits.json", []],
  ["mlb_total_bases.json", []],
  ["mlb_rbis.json", []],
  ["mlb_pitcher_strikeouts.json", []],
  ["pitch_type_damage.json", ["updated_at"]],
  ["pitch_type_damage_cache.json", []],
  ["mlb_weather.json", ["updatedAt"]],
  ["bullpen_relievers.json", ["updatedAt"]],
  ["mlb_home_runs.json", []],
  ["hr_probability_tracking.json", ["generatedAt"]],
  ["mlb_market_odds.json", ["generatedAt"]],
  ["hr_decision_center.json", ["updatedAt"]],
  ["player_card_data.json", ["updatedAt"]],
  ["live_change_alerts.json", ["generatedAt"]],
  ["hr_ai_breakdowns.json", ["updatedAt"]],
  ["hr_ai_history.json", ["updatedAt"]],
  ["hr_ai_movement.json", ["updatedAt"]],
  ["ai_trust_engine.json", ["updatedAt"]],
  ["ai_reasoning_engine.json", ["updatedAt"]],
  ["tag_registry.json", ["generatedAt"]],
  ["public_tags.json", ["generatedAt"]],
  ["ai_2.json", ["generatedAt"]],
  ["content/x_live_ai_board.json", ["generatedAt"]],
  ["health_status.json", ["generatedAt"]],
  ["site_last_updated.json", ["updatedAt", "updated_at"]]
];

const outputTimes = new Map();
for (const [file, timestampFields] of currentOutputs) {
  outputTimes.set(file, validateCurrentOutput(file, refreshAnchor, timestampFields));
}

validateDependencyOrder(outputTimes, "mlb_games_today.json", "mlb_player_pool.json");
validateDependencyOrder(outputTimes, "mlb_player_pool.json", "mlb_player_transactions.json");
validateDependencyOrder(outputTimes, "mlb_player_pool.json", "hr_power_profiles.json");
validateDependencyOrder(outputTimes, "mlb_player_pool.json", "pitch_type_damage.json");
validateDependencyOrder(outputTimes, "mlb_games_today.json", "mlb_weather.json");
validateDependencyOrder(outputTimes, "hr_power_profiles.json", "mlb_home_runs.json");
validateDependencyOrder(outputTimes, "pitch_type_damage.json", "mlb_home_runs.json");
validateDependencyOrder(outputTimes, "mlb_weather.json", "mlb_home_runs.json");
validateDependencyOrder(outputTimes, "bullpen_relievers.json", "mlb_home_runs.json");
validateDependencyOrder(outputTimes, "mlb_home_runs.json", "game_pitcher_matchups.json");
validateDependencyOrder(outputTimes, "game_pitcher_matchups.json", "lineup_impact_engine.json");
validateDependencyOrder(outputTimes, "game_pitcher_matchups.json", "statcast_zones.json");
validateDependencyOrder(outputTimes, "statcast_zones.json", "pitcher_attack_zones.json");
validateDependencyOrder(outputTimes, "mlb_home_runs.json", "pitcher_attack_zones.json");
validateDependencyOrder(outputTimes, "mlb_home_runs.json", "statcast_zones.json");
validateDependencyOrder(outputTimes, "mlb_home_runs.json", "hr_probability_tracking.json");
validateDependencyOrder(outputTimes, "hr_probability_tracking.json", "mlb_market_odds.json");
validateDependencyOrder(outputTimes, "game_pitcher_matchups.json", "mlb_hits.json");
validateDependencyOrder(outputTimes, "game_pitcher_matchups.json", "mlb_total_bases.json");
validateDependencyOrder(outputTimes, "game_pitcher_matchups.json", "mlb_pitcher_strikeouts.json");
validateDependencyOrder(outputTimes, "lineup_impact_engine.json", "hr_decision_center.json");
validateDependencyOrder(outputTimes, "pitcher_attack_zones.json", "hr_decision_center.json");
validateDependencyOrder(outputTimes, "statcast_zones.json", "hr_decision_center.json");
validateDependencyOrder(outputTimes, "hr_ai_breakdowns.json", "hr_ai_history.json");
validateDependencyOrder(outputTimes, "hr_ai_history.json", "hr_ai_movement.json");
validateDependencyOrder(outputTimes, "hr_ai_movement.json", "ai_trust_engine.json");
validateDependencyOrder(outputTimes, "ai_trust_engine.json", "ai_reasoning_engine.json");
validateDependencyOrder(outputTimes, "hr_probability_tracking.json", "ai_reasoning_engine.json");
validateDependencyOrder(outputTimes, "hr_probability_tracking.json", "tag_registry.json");
validateDependencyOrder(outputTimes, "mlb_player_pool.json", "live_change_alerts.json");
validateDependencyOrder(outputTimes, "game_pitcher_matchups.json", "live_change_alerts.json");
validateDependencyOrder(outputTimes, "pitcher_vulnerability.json", "live_change_alerts.json");
validateDependencyOrder(outputTimes, "hr_probability_tracking.json", "live_change_alerts.json");
validateDependencyOrder(outputTimes, "player_card_data.json", "live_change_alerts.json");
validateDependencyOrder(outputTimes, "tag_registry.json", "public_tags.json");
validateDependencyOrder(outputTimes, "public_tags.json", "ai_2.json");
validateDependencyOrder(outputTimes, "health_status.json", "site_last_updated.json");

validateSlateDate("mlb_games_today.json", "date", today);
validateSlateDate("mlb_player_pool.json", "date", today);
validateSlateDate("game_pitcher_matchups.json", "date", today);
validateSlateDate("pitcher_vulnerability.json", "date", today);
validateSlateDate("mlb_weather.json", "date", today);
validateSlateDate("hr_decision_center.json", "pitcherDate", today);
validateSlateDate("live_change_alerts.json", "date", today);
validateMarketOdds(today);
validatePitchDamageCache(today);
validatePitcherVulnerability(today);
validatePitcherRateFields();
validateRealStatcastZones(today);
validateRealPitcherAttackZones(today);
validateHealthStatus(today, refreshAnchor);
validatePlayerCardSignals();
validateLiveChangeAlerts(today);
validatePlayerResultEvents();
validateVerifiedPregameReceipts();
validateCalibrationReport();

const siteUpdated = read("site_last_updated.json");
if (siteUpdated.source !== "mlb_fast_refresh") {
  fail(`site_last_updated.json has unexpected source ${siteUpdated.source || "missing"}`);
}
if (siteUpdated.updatedAt !== siteUpdated.updated_at) {
  fail("site_last_updated.json timestamp fields do not match");
}

const obsoleteProductionSources = new Set([
  "advanced_player_intelligence.json",
  "player_card_profiles.json",
  "unified_player_tags.json",
  "mlb_team_stacks.json",
  "mlb_context_factors.json",
  "hr_chain_reaction.json"
]);

const reasoning = read("ai_reasoning_engine.json");
for (const source of Object.keys(reasoning.sourceDebug || {})) {
  if (obsoleteProductionSources.has(source)) {
    fail(`ai_reasoning_engine.json reused obsolete source ${source}`);
  }
}

function validateReasoningSignals() {
  const trust = read("ai_trust_engine.json");
  const trustByPlayer = new Map(
    (trust.players || []).map(row => [playerKey(row.player), Number(row.trustScore)])
  );
  const allowedSources = new Set([
    "ai_trust_engine.json",
    "hr_power_profiles.json",
    "hr_probability_tracking.json"
  ]);
  const reports = Array.isArray(reasoning.reports) ? reasoning.reports : [];

  if (!reports.length && !noGamesScheduled) {
    fail("ai_reasoning_engine.json has no reports for the active slate");
  }

  for (const report of reports) {
    const player = playerKey(report.player);
    if (!player) fail("ai_reasoning_engine.json contains a report without a player");
    if (!Array.isArray(report.supportingSignals) || !Array.isArray(report.counterSignals)) {
      fail(`AI Reasoning is missing balanced signal arrays for ${report.player}`);
    }
    if (!Array.isArray(report.whyToday) || !Array.isArray(report.riskFactors)) {
      fail(`AI Reasoning has invalid explanation arrays for ${report.player}`);
    }

    const expectedTrust = trustByPlayer.get(player);
    if (!Number.isFinite(expectedTrust) || Number(report.confidence) !== expectedTrust) {
      fail(`AI Reasoning confidence does not match AI Trust for ${report.player}`);
    }

    for (const item of [...report.supportingSignals, ...report.counterSignals]) {
      if (!item || !String(item.key || "").trim() || !String(item.label || "").trim() || !String(item.detail || "").trim()) {
        fail(`AI Reasoning has an incomplete structured signal for ${report.player}`);
      }
      if (!allowedSources.has(item.source)) {
        fail(`AI Reasoning has an unverified signal source for ${report.player}: ${item.source || "missing"}`);
      }
      if (!new Set(["support", "moderate", "high"]).has(item.severity)) {
        fail(`AI Reasoning has an invalid signal severity for ${report.player}`);
      }
      if (item.value !== null && !Number.isFinite(Number(item.value))) {
        fail(`AI Reasoning has a non-numeric signal value for ${report.player}`);
      }
    }

    const expected = report.expected || {};
    if (expected.pitch === "Best matchup pitch" || expected.zone === "Damage zone" || expected.count === "Hitter's count") {
      fail(`AI Reasoning reused a legacy invented expectation for ${report.player}`);
    }
  }
}

const registry = read("tag_registry.json");
for (const tag of registry.tags || []) {
  for (const source of tag.source || []) {
    if (obsoleteProductionSources.has(source)) {
      fail(`tag_registry.json reused obsolete source ${source}`);
    }
  }
}

function playerKey(value) {
  return String(value || "").trim().toLowerCase();
}

validateReasoningSignals();

const tracking = read("hr_probability_tracking.json");
const trackingByPlayer = new Map(
  (tracking.players || []).map(row => [playerKey(row.player), Number(row.realHrProbability)])
);
const reasoningByPlayer = new Map(
  (reasoning.reports || []).map(row => [playerKey(row.player), Number(row.probability)])
);
const breakdowns = read("hr_ai_breakdowns.json");
const breakdownByPlayer = new Map(
  Object.values(breakdowns.players || {}).map(row => [playerKey(row.player), Number(row.confidence)])
);

for (const [player, probability] of trackingByPlayer) {
  if (!reasoningByPlayer.has(player)) fail(`AI Reasoning is missing probability row for ${player}`);
  if (Math.abs(reasoningByPlayer.get(player) - probability) > 0.05) {
    fail(`AI Reasoning probability does not match tracking for ${player}`);
  }

  if (!breakdownByPlayer.has(player)) fail(`AI Breakdowns is missing probability row for ${player}`);
  if (Math.abs(breakdownByPlayer.get(player) - probability) > 0.05) {
    fail(`AI Breakdowns confidence does not match tracking for ${player}`);
  }
}

const pool = read("mlb_player_pool.json");
if (pool.date !== slateDate) fail(`mlb_player_pool date is ${pool.date}, expected slate date ${slateDate}`);
if (!Array.isArray(pool.players)) fail("player pool players is not an array");
const poolGamesByPlayerId = new Map();
for (const player of pool.players) {
  const playerId = String(player.playerId || "");
  if (!playerId) fail("player pool contains a player without an MLB ID");
  const verification = player.ownershipVerification;
  if (verification?.status !== "VERIFIED" || String(verification.playerId) !== playerId || String(verification.teamId) !== String(player.teamId) || !Number.isFinite(Date.parse(verification.verifiedAt))) {
    fail(`player pool has invalid ownership verification for ${player.player || playerId}`);
  }
  if (!poolGamesByPlayerId.has(playerId)) poolGamesByPlayerId.set(playerId, new Set());
  poolGamesByPlayerId.get(playerId).add(String(player.gamePk || ""));
}
for (const [playerId, gamePks] of poolGamesByPlayerId) {
  if (gamePks.size > 1) fail(`MLB ID ${playerId} appears in multiple slate games: ${[...gamePks].join(", ")}`);
}

const identityLedger = read("mlb_player_transactions.json");
if (identityLedger?.schemaVersion !== "1.0" || !Array.isArray(identityLedger.events) || Number(identityLedger.eventCount) !== identityLedger.events.length) {
  fail("mlb_player_transactions.json has an invalid ledger schema");
}
const identityEventIds = new Set();
for (const event of identityLedger.events) {
  if (!event.eventId || identityEventIds.has(event.eventId) || !["TEAM_CHANGE", "STALE_OWNERSHIP_REJECTED"].includes(event.type) || !event.playerId) {
    fail("mlb_player_transactions.json contains an invalid or duplicate event");
  }
  identityEventIds.add(event.eventId);
}

if (noGamesScheduled) {
  const zeroSlateOutputs = [
    ["mlb_player_pool.json", pool.availability === "no_games_scheduled" && pool.players.length === 0],
    ["game_pitcher_matchups.json", read("game_pitcher_matchups.json").availability === "no_games_scheduled" && read("game_pitcher_matchups.json").games?.length === 0],
    ["hr_decision_center.json", read("hr_decision_center.json").availability === "no_games_scheduled" && read("hr_decision_center.json").allPlayers?.length === 0],
    ["mlb_home_runs.json", Array.isArray(read("mlb_home_runs.json")) && read("mlb_home_runs.json").length === 0],
    ["mlb_hits.json", Array.isArray(read("mlb_hits.json")) && read("mlb_hits.json").length === 0],
    ["mlb_total_bases.json", Array.isArray(read("mlb_total_bases.json")) && read("mlb_total_bases.json").length === 0],
    ["mlb_rbis.json", Array.isArray(read("mlb_rbis.json")) && read("mlb_rbis.json").length === 0]
  ];

  for (const [file, valid] of zeroSlateOutputs) {
    if (!valid) fail(`${file} is not a current empty no-games output`);
  }
} else if (specialEventSlate) {
  if (pool.players.length < 18) fail("All-Star player pool is too small");

  const allStarGames = scheduleGames.filter(game => game.gameType === "A");
  for (const game of allStarGames) {
    const awayPlayers = pool.players.filter(
      player => String(player.gamePk) === String(game.gamePk) && player.homeAway === "away"
    );
    const homePlayers = pool.players.filter(
      player => String(player.gamePk) === String(game.gamePk) && player.homeAway === "home"
    );

    if (awayPlayers.length < 9 || homePlayers.length < 9) {
      fail(`${game.matchup} does not have at least nine official hitters on both sides`);
    }

    const invalidSource = [...awayPlayers, ...homePlayers].find(
      player => !["MLB_ACTIVE_ROSTER", "MLB_GAME_BOXSCORE", "MLB_GAME_LINEUP"].includes(player.rosterSource)
    );
    if (invalidSource) {
      fail(`${game.matchup} contains a hitter without a verified MLB roster source`);
    }
  }
} else if (pool.players.length < 50) {
  fail("player pool is too small");
}

const analysisGamePks = new Set(
  pool.players
    .map(player => String(player.gamePk || "").trim())
    .filter(Boolean)
);

if (!noGamesScheduled && !analysisGamePks.size) fail("player pool contains no canonical analysis game IDs");

const matchups = read("game_pitcher_matchups.json");
if (!Array.isArray(matchups.games) || matchups.games.length !== analysisGamePks.size) {
  fail("matchup game count does not match the canonical player-pool games");
}

const matchupGamePks = new Set(matchups.games.map(game => String(game.gamePk || "").trim()).filter(Boolean));
if (
  matchupGamePks.size !== analysisGamePks.size ||
  [...analysisGamePks].some(gamePk => !matchupGamePks.has(gamePk))
) {
  fail("matchup game IDs do not match the canonical player-pool game IDs");
}

for (const g of matchups.games) {
  const away = g.hitters?.away?.length || 0;
  const home = g.hitters?.home?.length || 0;

  if (away === 0 || home === 0) fail(`${g.matchup} has empty hitters`);

  const threats = g.topThreats || [];
  if (threats.length === 0) fail(`${g.matchup} has no top threats`);

  const maxScore = Math.max(...threats.map(t => Number(t.score || 0)));
  if (maxScore <= 0) fail(`${g.matchup} has zero threat scores`);
}

const hr = read("mlb_home_runs.json");
const minimumHrRows = specialEventSlate ? Math.min(40, pool.players.length) : 40;
if (!Array.isArray(hr) || (!noGamesScheduled && hr.length < minimumHrRows)) fail("HR board is too small");

const hits = read("mlb_hits.json");
const minimumPropRows = specialEventSlate ? Math.min(20, pool.players.length) : 20;
if (!Array.isArray(hits) || (!noGamesScheduled && hits.length < minimumPropRows)) fail("Hits board is too small");

const tb = read("mlb_total_bases.json");
if (!Array.isArray(tb) || (!noGamesScheduled && tb.length < minimumPropRows)) fail("Total Bases board is too small");

const rbis = read("mlb_rbis.json");
if (!Array.isArray(rbis) || (!noGamesScheduled && rbis.length < minimumPropRows)) fail("RBI board is too small");

console.log("MLB validation passed:", slateDate);
