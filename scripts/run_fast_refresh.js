import { spawnSync } from "child_process";
import fs from "fs";
import { dataQualityPenaltyIssue } from "./mlb/lib/data_quality_confidence.js";
import { validHealthFreshnessWindow } from "./mlb/refresh_freshness.mjs";

const requestedStart = Number(process.env.MLB_REFRESH_STARTED_AT);
const REFRESH_STARTED_AT = Number.isFinite(requestedStart) && requestedStart > 0 ? requestedStart : Date.now();
const DATA_DIR = "website/data";

function todayEastern() {
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

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function outputPath(file) {
  return `${DATA_DIR}/${file}`;
}

function validateRebuiltOutput({ file, timestampFields = [] }) {
  const fullPath = file.startsWith("website/") || file.startsWith("exports/")
    ? file
    : outputPath(file);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Required refresh output is missing: ${fullPath}`);
  }

  const stat = fs.statSync(fullPath);
  if (stat.mtimeMs < REFRESH_STARTED_AT - 1000) {
    throw new Error(`Output was not rebuilt during this refresh: ${fullPath}`);
  }

  if (!timestampFields.length) return stat.mtimeMs;

  const payload = readJson(fullPath);
  const field = timestampFields.find(name => payload?.[name]);
  if (!field) {
    throw new Error(`${fullPath} is missing timestamp field ${timestampFields.join(" or ")}`);
  }

  const timestamp = Date.parse(payload[field]);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${fullPath} has invalid ${field}: ${payload[field]}`);
  }

  if (timestamp < REFRESH_STARTED_AT - 1000) {
    throw new Error(`${fullPath} contains a pre-refresh ${field}: ${payload[field]}`);
  }

  return stat.mtimeMs;
}

function validateSlateDate(file, field, expectedDate) {
  const fullPath = outputPath(file);
  const payload = readJson(fullPath);
  const actual = payload?.[field];

  if (actual !== expectedDate) {
    throw new Error(`${fullPath} ${field} is ${actual || "missing"}; expected ${expectedDate}`);
  }
}

function validateLiveChangeAlerts(expectedDate) {
  const payload = readJson(outputPath("live_change_alerts.json"));
  const statuses = new Set(["baseline_established", "ready", "no_games_scheduled"]);
  if (payload?.schemaVersion !== "1.0" || payload?.date !== expectedDate || !statuses.has(payload?.status)) {
    throw new Error("live_change_alerts.json has invalid metadata");
  }
  if (!Array.isArray(payload.alerts) || !payload.snapshot?.players || !payload.snapshot?.pitchers) {
    throw new Error("live_change_alerts.json has invalid collections");
  }
  const ids = new Set();
  for (const alert of payload.alerts) {
    if (!alert?.id || !alert?.kind || !alert?.entityType || !alert?.entityId || !alert?.entityName || alert?.date !== expectedDate || alert?.sport !== "MLB" || !Number.isFinite(Date.parse(alert?.createdAt))) {
      throw new Error("live_change_alerts.json contains an invalid alert");
    }
    if (ids.has(alert.id)) throw new Error(`live_change_alerts.json contains duplicate alert ${alert.id}`);
    ids.add(alert.id);
  }
}

function validateDependencyOrder(times, before, after) {
  if (times.get(before) > times.get(after)) {
    throw new Error(`${before} was written after dependent output ${after}`);
  }
}

function validateVerifiedPregameReceipts() {
  const payload = readJson(outputPath("hr_ai_history.json"));
  const history = payload?.history;
  if (!history || typeof history !== "object" || Array.isArray(history)) {
    throw new Error("hr_ai_history.json has an invalid history object");
  }

  let verifiedCount = 0;
  for (const snapshots of Object.values(history)) {
    if (!Array.isArray(snapshots)) {
      throw new Error("hr_ai_history.json contains a non-array player history");
    }

    for (const receipt of snapshots) {
      if (receipt?.verifiedPregame !== true) continue;
      verifiedCount++;

      const snapshotAt = Date.parse(receipt.snapshotAt || receipt.timestamp);
      const gameStartTime = Date.parse(receipt.gameStartTime);
      const expectedId = `${receipt.slateDate}|${receipt.gamePk}|${receipt.playerId}`;
      if (!receipt.slateDate || !Number(receipt.gamePk) || !Number(receipt.playerId)) {
        throw new Error("Verified HR receipt is missing its canonical game/player identity");
      }
      if (receipt.receiptId !== expectedId) {
        throw new Error(`Verified HR receipt has invalid receiptId ${receipt.receiptId || "missing"}`);
      }
      if (!Number.isFinite(snapshotAt) || !Number.isFinite(gameStartTime) || snapshotAt >= gameStartTime) {
        throw new Error(`Verified HR receipt ${receipt.receiptId} was not captured before first pitch`);
      }
      if (!receipt.modelVersion || receipt.verificationStatus !== "verified_before_first_pitch") {
        throw new Error(`Verified HR receipt ${receipt.receiptId} is missing model verification metadata`);
      }
      if (receipt.probability !== null && receipt.probability !== undefined) {
        const probability = Number(receipt.probability);
        if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
          throw new Error(`Verified HR receipt ${receipt.receiptId} has invalid probability`);
        }
      }
    }
  }

  if (Number(payload?.verification?.verifiedReceiptCount) !== verifiedCount) {
    throw new Error("hr_ai_history.json verified receipt count does not match stored receipts");
  }
  const coverage = payload?.verification?.currentSlateAnalysis;
  if (!coverage || !Array.isArray(coverage.expectedGamePks)
    || !Array.isArray(coverage.capturedGamePks) || !Array.isArray(coverage.missingGamePks)) {
    throw new Error("hr_ai_history.json is missing current slate analysis coverage");
  }
  if (coverage.missingGamePks.length || coverage.complete !== true) {
    throw new Error(`hr_ai_history.json is missing verified pregame coverage for analysis gamePks: ${coverage.missingGamePks.join(", ")}`);
  }
}

function validateCalibrationReport() {
  const report = readJson(outputPath("hr_calibration_report.json"));
  if (report?.schemaVersion !== "2.0" || report?.verification?.join !== "slateDate+gamePk+playerId") {
    throw new Error("hr_calibration_report.json is not using the verified receipt schema");
  }

  for (const window of ["7d", "30d", "season"]) {
    const metrics = report?.windows?.[window];
    if (!metrics) throw new Error(`hr_calibration_report.json is missing ${window} metrics`);
    const predictions = Number(metrics.predictions);
    const hits = Number(metrics.hits);
    if (!Number.isInteger(predictions) || !Number.isInteger(hits) || predictions < 0 || hits < 0 || hits > predictions) {
      throw new Error(`hr_calibration_report.json has invalid ${window} counts`);
    }
  }

  if (Number(report?.summary?.fullBoard?.predictions) !== Number(report?.windows?.season?.predictions)) {
    throw new Error("hr_calibration_report.json season summary is inconsistent");
  }
}

function validatePitchDamageCache(expectedDate) {
  const pool = readJson(outputPath("mlb_player_pool.json"));
  const cache = readJson(outputPath("pitch_type_damage_cache.json"));
  const damage = readJson(outputPath("pitch_type_damage.json"));
  const players = Array.isArray(pool.players) ? pool.players : [];

  if (!cache.players || typeof cache.players !== "object" || Array.isArray(cache.players)) {
    throw new Error("pitch_type_damage_cache.json has an invalid players object");
  }

  if (!damage.players || typeof damage.players !== "object" || Array.isArray(damage.players)) {
    throw new Error("pitch_type_damage.json has an invalid players object");
  }

  const playerNamesById = new Map();

  for (const player of players) {
    const playerId = String(player.playerId || player.mlbId || player.id || "").trim();
    const playerName = String(player.player || "").trim();
    if (!playerId || !playerName) {
      throw new Error(`Current player pool contains a player without a name or MLB ID`);
    }

    const existingName = playerNamesById.get(playerId);
    if (existingName && existingName !== playerName) {
      throw new Error(`Current player pool has conflicting names for MLB ID ${playerId}: ${existingName}, ${playerName}`);
    }
    playerNamesById.set(playerId, playerName);

    const cached = cache.players[`${playerId}|${expectedDate.slice(0, 4)}`];
    if (!cached || easternDate(cached.cached_at) !== expectedDate) {
      throw new Error(`Pitch damage cache is not current for ${playerName}`);
    }

    const damageRow = damage.players[playerId];
    if (!damageRow || String(damageRow.playerId || "") !== playerId || String(damageRow.player || "") !== playerName) {
      throw new Error(`pitch_type_damage.json is missing the ID-keyed record for ${playerName} (${playerId})`);
    }
  }

  if (Object.keys(damage.players).length !== playerNamesById.size) {
    throw new Error(
      `pitch_type_damage.json has ${Object.keys(damage.players).length} players; expected ${playerNamesById.size}`
    );
  }
}

function validatePlayerPoolOwnership() {
  const pool = readJson(outputPath("mlb_player_pool.json"));
  const gamesByPlayerId = new Map();
  for (const player of pool.players || []) {
    const playerId = String(player.playerId || "");
    if (!playerId) throw new Error("player pool contains a player without an MLB ID");
    const verification = player.ownershipVerification;
    if (verification?.status !== "VERIFIED" || String(verification.playerId) !== playerId || String(verification.teamId) !== String(player.teamId) || !Number.isFinite(Date.parse(verification.verifiedAt))) {
      throw new Error(`player pool has invalid ownership verification for ${player.player || playerId}`);
    }
    if (!gamesByPlayerId.has(playerId)) gamesByPlayerId.set(playerId, new Set());
    gamesByPlayerId.get(playerId).add(String(player.gamePk || ""));
  }
  for (const [playerId, gamePks] of gamesByPlayerId) {
    if (gamePks.size > 1) {
      throw new Error(`MLB ID ${playerId} appears in multiple slate games: ${[...gamePks].join(", ")}`);
    }
  }

  const ledger = readJson(outputPath("mlb_player_transactions.json"));
  if (ledger?.schemaVersion !== "1.0" || !Array.isArray(ledger.events) || Number(ledger.eventCount) !== ledger.events.length) {
    throw new Error("mlb_player_transactions.json has an invalid ledger schema");
  }
  const eventIds = new Set();
  for (const event of ledger.events) {
    if (!event.eventId || eventIds.has(event.eventId) || !["TEAM_CHANGE", "STALE_OWNERSHIP_REJECTED"].includes(event.type) || !event.playerId) {
      throw new Error("mlb_player_transactions.json contains an invalid or duplicate event");
    }
    eventIds.add(event.eventId);
  }
}

function validateHealthStatus(expectedDate) {
  const health = readJson(outputPath("health_status.json"));
  const updatedAt = Date.parse(health.updatedAt);
  const generatedAt = Date.parse(health.generatedAt);
  const games = readJson(outputPath("mlb_games_today.json"));
  const noGamesScheduled = games.date === expectedDate
    && Array.isArray(games.games)
    && games.games.length === 0;
  const expectedLabel = noGamesScheduled ? "CLOSED" : "LIVE";

  if (health.status !== "healthy" || health.label !== expectedLabel) {
    throw new Error(`health_status.json is not healthy: ${(health.errors || []).join(" | ") || "unknown error"}`);
  }

  if (noGamesScheduled && health.availability !== "no_games_scheduled") {
    throw new Error("health_status.json does not declare the verified no-games state");
  }

  if (health.source !== "mlb_fast_refresh") {
    throw new Error(`health_status.json has unexpected source ${health.source || "missing"}`);
  }

  if (health.slateDate !== expectedDate) {
    throw new Error(`health_status.json monitoring slate is ${health.slateDate || "missing"}; expected ${expectedDate}`);
  }

  const monitoring = health.monitoring || {};
  const expectedState = noGamesScheduled ? "closed" : "live";
  const checkedAt = Date.parse(monitoring.checkedAt);
  const lastSuccessfulAt = Date.parse(monitoring.lastSuccessfulAt);
  const freshUntil = Date.parse(monitoring.freshUntil);
  if (monitoring.state !== expectedState) {
    throw new Error(`health_status.json monitoring state is ${monitoring.state || "missing"}; expected ${expectedState}`);
  }
  if (!Number.isFinite(generatedAt) || checkedAt !== generatedAt || lastSuccessfulAt !== generatedAt) {
    throw new Error("health_status.json monitoring timestamps do not identify the completed refresh");
  }
  const artifactDeadlines = Object.values(health.artifacts || {})
    .filter(artifact => artifact?.required === true)
    .map(artifact => Date.parse(artifact.timestamp) + Number(artifact.maxAgeSeconds) * 1000);
  if (monitoring.refreshWindowSeconds !== 900 || !validHealthFreshnessWindow({
    generatedAt,
    freshUntil,
    refreshWindowMs: 15 * 60 * 1000,
    artifactDeadlines
  })) {
    throw new Error("health_status.json monitoring freshness window is invalid");
  }

  const requiredArtifacts = ["games", "playerPool", "hrBoard", "matchups", "decision", "weather"];
  for (const key of requiredArtifacts) {
    const artifact = health.artifacts?.[key];
    if (!artifact || artifact.required !== true || artifact.freshness !== "current") {
      throw new Error(`health_status.json has invalid monitoring metadata for ${key}`);
    }
    if (!artifact.file || !Number.isFinite(Date.parse(artifact.timestamp)) || !Number.isFinite(artifact.ageSeconds)) {
      throw new Error(`health_status.json has incomplete artifact monitoring metadata for ${key}`);
    }
  }

  if (!Number.isFinite(updatedAt) || updatedAt < REFRESH_STARTED_AT - 1000) {
    throw new Error("health_status.json updatedAt does not belong to the current refresh");
  }

  if (games.date !== expectedDate) {
    throw new Error(`Health status is not tied to the ${expectedDate} slate`);
  }
}

function validatePitcherVulnerability(expectedDate) {
  const matchups = readJson(outputPath("game_pitcher_matchups.json"));
  const payload = readJson(outputPath("pitcher_vulnerability.json"));
  const rows = Array.isArray(payload.pitchers) ? payload.pitchers : [];
  const expectedCount = (matchups.games || []).length * 2;
  const baseline = Number(payload.liveSlateMedian);

  if (payload.date !== expectedDate || payload.source !== "MLB Stats API live season pitching") {
    throw new Error("pitcher_vulnerability.json has stale date or non-live source provenance");
  }
  if (payload.scale !== "0-100 risk index; not a probability") {
    throw new Error("pitcher_vulnerability.json does not declare the canonical risk-index scale");
  }
  if (rows.length !== expectedCount || Number(payload.count) !== expectedCount) {
    throw new Error(`pitcher_vulnerability.json has ${rows.length} pitchers; expected ${expectedCount}`);
  }
  if (!Number.isFinite(baseline)) throw new Error("pitcher_vulnerability.json is missing its live-slate median");

  const byId = new Map();
  for (const row of rows) {
    const id = String(row.id || "");
    const available = row.available !== false;
    const score = Number(row.vulnerability);
    const raw = Number(row.vulnerabilityRaw);
    const weight = Number(row.vulnerabilitySampleWeight);
    const innings = Number(row.vulnerabilityTrueInnings);
    if (!id || byId.has(id)) throw new Error(`pitcher_vulnerability.json has a missing or duplicate pitcher ID ${id || "unknown"}`);
    if (!available) {
      if (!["pending", "updating"].includes(row.status) || row.vulnerability !== null || row.stats !== null) {
        throw new Error(`Unavailable pitcher ${row.pitcher || id} must be marked pending/updating without invented stats or risk`);
      }
      byId.set(id, null);
      continue;
    }
    if (!Number.isFinite(score) || score < 12 || score > 98) throw new Error(`Invalid risk index for ${row.pitcher || id}`);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) throw new Error(`Invalid raw risk index for ${row.pitcher || id}`);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1) throw new Error(`Invalid sample weight for ${row.pitcher || id}`);
    if (!Number.isFinite(innings) || innings <= 0) throw new Error(`Invalid true innings for ${row.pitcher || id}`);
    if (Math.abs(weight - Math.min(1, innings / 60)) > 0.001) throw new Error(`Sample weight does not match live innings for ${row.pitcher || id}`);
    if (Math.abs(score - baseline) > Math.abs(raw - baseline) + 1) throw new Error(`Short-sample stabilization moved ${row.pitcher || id} away from the live baseline`);
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
        throw new Error(`${game.matchup || game.game} has a non-canonical ${side} pitcher risk index`);
      }
    }
  }
}

function validateRealStatcastZones(expectedDate) {
  const pool = readJson(outputPath("mlb_player_pool.json"));
  const matchups = readJson(outputPath("game_pitcher_matchups.json"));
  const statcast = readJson(outputPath("statcast_zones.json"));
  const players = Array.isArray(pool.players) ? pool.players : [];
  const pitcherIds = new Set();

  for (const game of matchups.games || []) {
    for (const side of ["away", "home"]) {
      const profile = game[`${side}Pitcher`] || {};
      const pitcherId = profile.id || profile.playerId || game[`${side}ProbablePitcherId`];
      const pitcher = clean(profile.name || profile.pitcher || game[`${side}ProbablePitcher`] || "");
      if (profile.available === false || !pitcherId || !pitcher || pitcher === "TBD") continue;
      pitcherIds.add(String(pitcherId));
    }
  }

  if (statcast.source !== "baseball_savant_statcast_pitch_detail_csv") {
    throw new Error(`statcast_zones.json has non-Statcast source ${statcast.source || "missing"}`);
  }

  if (statcast.date !== expectedDate) {
    throw new Error(`statcast_zones.json date is ${statcast.date || "missing"}; expected ${expectedDate}`);
  }

  if (!statcast.players || Object.keys(statcast.players).length !== players.length) {
    throw new Error(`statcast_zones.json does not contain exactly ${players.length} current players`);
  }

  for (const player of players) {
    const row = statcast.players[String(player.playerId || player.mlbId || player.id)] || statcast.players[player.player];
    if (!row || String(row.playerId || row.mlbId || "") !== String(player.playerId || player.mlbId || player.id)) {
      throw new Error(`statcast_zones.json is missing the current row for ${player.player}`);
    }
    if (easternDate(row.cached_at) !== expectedDate) {
      throw new Error(`Statcast zones are not current for ${player.player}`);
    }
    for (const metric of ["avg", "iso", "slg", "xwoba", "hr", "k", "hardHit", "barrel", "raw"]) {
      if (!Array.isArray(row.zones?.[metric]) || row.zones[metric].length !== 25) {
        throw new Error(`Statcast ${metric} zones are invalid for ${player.player}`);
      }
    }
    const recent = row.recentForm;
    if (recent?.schemaVersion !== "1.0" || !["last7", "last15", "last30", "season"].every(key => recent[key])) {
      throw new Error(`Statcast recent form is invalid for ${player.player}`);
    }
    if (Number(recent.reliability) < 0 || Number(recent.reliability) > 1 || Math.abs(Number(recent.modelAdjustment)) > 2.5) {
      throw new Error(`Statcast recent form adjustment is unsafe for ${player.player}`);
    }
  }

  if (!statcast.pitchers || Object.keys(statcast.pitchers).length !== pitcherIds.size) {
    throw new Error(`statcast_zones.json does not contain exactly ${pitcherIds.size} current pitchers`);
  }

  for (const pitcherId of pitcherIds) {
    const row = statcast.pitchers[pitcherId];
    if (!row || String(row.pitcherId || row.playerId || row.mlbId || "") !== pitcherId) {
      throw new Error(`statcast_zones.json is missing current pitcher ${pitcherId}`);
    }
    if (easternDate(row.cached_at) !== expectedDate) {
      throw new Error(`Statcast pitcher zones are not current for ${row.pitcher || pitcherId}`);
    }
    const hasRealSample = Number(row.rows) > 0 && Number(row.zonePitchCount) > 0;
    const markedNoSample = row.source === "no_real_statcast_sample" && Number(row.zonePitchCount) === 0;
    if (!hasRealSample && !markedNoSample) {
      throw new Error(`Statcast pitcher zones have no real sample for ${row.pitcher || pitcherId}`);
    }
    for (const metric of ["avg", "iso", "slg", "xwoba", "hr", "k", "hardHit", "barrel", "raw"]) {
      if (!Array.isArray(row.zones?.[metric]) || row.zones[metric].length !== 25) {
        throw new Error(`Statcast pitcher ${metric} zones are invalid for ${row.pitcher || pitcherId}`);
      }
    }
  }

  if (Number(statcast.pitcherCount) !== pitcherIds.size) {
    throw new Error("Statcast pitcherCount does not match current probable pitchers");
  }
  const pitchersWithRows = Object.values(statcast.pitchers).filter(row => Number(row.rows) > 0).length;
  const pitchersWithZones = Object.values(statcast.pitchers).filter(row => Number(row.zonePitchCount) > 0).length;
  if (Number(statcast.pitchersWithRows) !== pitchersWithRows || Number(statcast.pitchersWithZones) !== pitchersWithZones) {
    throw new Error("Statcast pitcher coverage counts are incorrect");
  }
}

function validateRealPitcherAttackZones(expectedDate) {
  const hr = readJson(outputPath("mlb_home_runs.json"));
  const matchups = readJson(outputPath("game_pitcher_matchups.json"));
  const statcast = readJson(outputPath("statcast_zones.json"));
  const attack = readJson(outputPath("pitcher_attack_zones.json"));
  const decision = readJson(outputPath("hr_decision_center.json"));
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
    throw new Error(`pitcher_attack_zones.json has non-Statcast source ${attack.source || "missing"}`);
  }
  if (attack.date !== expectedDate || attack.statcastSource !== statcast.source) {
    throw new Error("pitcher_attack_zones.json has stale date or source provenance");
  }
  if (!attack.players || Object.keys(attack.players).length !== hr.length) {
    throw new Error(`pitcher_attack_zones.json does not contain exactly ${hr.length} players`);
  }

  if (!Array.isArray(decision.allPlayers)) throw new Error("Decision Center is missing allPlayers rows");

  const decisionByPlayer = new Map();
  for (const row of decision.allPlayers || []) {
    if (row.playerId) decisionByPlayer.set(String(row.playerId), row);
    if (row.player) decisionByPlayer.set(row.player, row);
    const exposure = row.pitchingExposure;
    const expectedPa = Number(row.projectedPlateAppearances || 0);
    if (!exposure || Math.abs(Number(exposure.starterPlateAppearances) + Number(exposure.bullpenPlateAppearances) - expectedPa) > 0.011) {
      throw new Error(`Decision Center has invalid pitching exposure for ${row.player}`);
    }
    if (expectedPa === 0) {
      if (Number(exposure.blendedPitchingRisk) !== 0) throw new Error(`Inactive player has pitching exposure for ${row.player}`);
    } else if (Number(exposure.starterShare) !== 0.58 || Number(exposure.bullpenShare) !== 0.42) {
      throw new Error(`Decision Center has invalid pitching exposure shares for ${row.player}`);
    }
    const quality = row.dataQuality;
    const rawConfidence = Number(row.rawModelConfidence);
    const adjustedConfidence = Number(row.hrConfidence);
    if (!quality || Number(quality.score) < 0 || Number(quality.score) > 100) {
      throw new Error(`Decision Center has invalid data quality for ${row.player}`);
    }
    const penaltyIssue = dataQualityPenaltyIssue(rawConfidence, adjustedConfidence, quality);
    if (penaltyIssue) throw new Error(`Decision Center has unsafe data quality penalty for ${row.player}: ${penaltyIssue} (raw=${rawConfidence}, adjusted=${adjustedConfidence}, factor=${quality.penaltyFactor})`);
    const movement = row.movement;
    if (!movement || !["NEW", "UP", "DOWN", "UNCHANGED"].includes(movement.direction) || !Array.isArray(movement.reasons)) {
      throw new Error(`Decision Center has invalid movement for ${row.player}`);
    }
    if (movement.status !== "INITIAL_SNAPSHOT") {
      const expectedDelta = Math.round((Number(movement.currentConfidence) - Number(movement.previousConfidence)) * 10) / 10;
      if (Math.abs(expectedDelta - Number(movement.confidenceDelta)) > 0.01 || Number(movement.currentConfidence) !== adjustedConfidence) {
        throw new Error(`Decision Center movement delta is invalid for ${row.player}`);
      }
    }
    for (const reason of movement.reasons) {
      if (!reason?.key || !reason?.label || !["support", "risk", "neutral"].includes(reason.impact)) {
        throw new Error(`Decision Center has invalid movement reason for ${row.player}`);
      }
    }
    const ownership = row.ownershipVerification;
    if (ownership?.status !== "VERIFIED" || String(ownership.playerId) !== String(row.playerId) || String(ownership.teamId) !== String(row.teamId)) {
      throw new Error(`Decision Center has invalid ownership verification for ${row.player}`);
    }
  }
  for (const player of hr) {
    if (!decisionByPlayer.has(String(player.playerId))) {
      throw new Error(`Decision Center is missing current player ID for ${player.player}`);
    }
  }
  const roundTo = (value, places = 2) => {
    const mult = 10 ** places;
    return Math.round(Number(value) * mult) / mult;
  };
  const overallXwoba = (raw, requireSamples = true) => {
    const total = raw.reduce((sum, cell) => sum + Number(cell?.xwobaTotal || 0), 0);
    const count = raw.reduce((sum, cell) => sum + Number(cell?.xwobaCount || 0), 0);
    if (!count && requireSamples) throw new Error("Real attack-zone validation found a pitcher without xwOBA samples");
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
        throw new Error(`Pending attack-zone dependency is not marked for ${player.player}`);
      }
      if (row.zones?.zoneSignalAvailable !== false || row.zones?.pitcherLeak !== null || !Array.isArray(row.zones?.zones) || row.zones.zones.length !== 25) {
        throw new Error(`Pending attack-zone grid is invalid for ${player.player}`);
      }
      if (!decisionRow || decisionRow.zoneOverlap !== null || decisionRow.zoneSignalAvailable !== false || Number(decisionRow.pitcherRisk) !== 0) {
        throw new Error(`Decision Center pending zone fallback is incorrect for ${player.player}`);
      }
      continue;
    }

    if (!row || !pitcherId || !hitterCard || !pitcherCard) {
      throw new Error(`Real attack-zone dependency is missing for ${player.player}`);
    }
    if (String(row.opposingPitcherId) !== pitcherId) {
      throw new Error(`Attack-zone pitcher mapping is incorrect for ${player.player}`);
    }

    const hitterXwoba = overallXwoba(hitterCard.zones.raw, false);
    const hitterOverall = hitterXwoba === null ? null : Math.min(100, hitterXwoba * 100);
    const pitcherXwoba = overallXwoba(pitcherCard.zones.raw, false);
    const pitcherOverall = pitcherXwoba === null ? null : Math.min(100, pitcherXwoba * 100);
    if (hitterOverall === null ? row.zones?.hitterPower !== null : Math.abs(Number(row.zones?.hitterPower) - roundTo(hitterOverall)) > 0.01) {
      throw new Error(`Attack-zone hitter power is incorrect for ${player.player}`);
    }
    if (row.zones?.qualified !== (hitterOverall !== null)) {
      throw new Error(`Attack-zone qualification is incorrect for ${player.player}`);
    }
    if (pitcherOverall === null ? row.zones?.pitcherLeak !== null : Math.abs(Number(row.zones?.pitcherLeak) - roundTo(pitcherOverall)) > 0.01) {
      throw new Error(`Attack-zone pitcher leak is incorrect for ${player.player}`);
    }

    const cells = row.zones?.zones;
    if (!Array.isArray(cells) || cells.length !== 25) {
      throw new Error(`Attack-zone grid is invalid for ${player.player}`);
    }

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
        throw new Error(`Attack-zone samples are incorrect for ${player.player} zone ${index + 1}`);
      }
      if (expectedDanger === null ? cell.danger !== null : Math.abs(Number(cell.danger) - expectedDanger) > 0.01) {
        throw new Error(`Attack-zone overlap is incorrect for ${player.player} zone ${index + 1}`);
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
      throw new Error(`Decision Center is missing current player ID for ${player.player}`);
    }
    if (!decisionRow || (expectedScore === null
      ? decisionRow.zoneOverlap !== null || decisionRow.zoneSignalAvailable !== false
      : Math.abs(Number(decisionRow.zoneOverlap) - expectedScore) > 0.01)) {
      throw new Error(`Decision Center zone overlap is incorrect for ${player.player}`);
    }
    const expectedPitcherRisk = expectedScore === null ? (pitcherOverall === null ? 0 : roundTo(pitcherOverall)) : expectedScore;
    if (Math.abs(Number(decisionRow.pitcherRisk) - expectedPitcherRisk) > 0.01) {
      throw new Error(`Decision Center pitcher risk is incorrect for ${player.player}`);
    }
    if (Number(decisionRow.hotZoneCount) !== hotCount) {
      throw new Error(`Decision Center hot-zone count is incorrect for ${player.player}`);
    }
  }
}

function writeSiteLastUpdated() {
  const timestamp = new Date().toISOString();
  const fullPath = outputPath("site_last_updated.json");
  const payload = {
    updatedAt: timestamp,
    updated_at: timestamp,
    source: "mlb_fast_refresh"
  };

  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2));

  const written = readJson(fullPath);
  if (
    written.updatedAt !== timestamp ||
    written.updated_at !== timestamp ||
    written.source !== "mlb_fast_refresh"
  ) {
    throw new Error("site_last_updated.json could not be verified after writing");
  }
}

function run(label, command) {
  console.log("");
  console.log("RUNNING:", label);

  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    env: process.env
  });

  if (result.status !== 0) {
    console.log("");
    console.error("FAILED:", label);
    process.exit(result.status || 1);
  }
}

const refreshProfile = process.env.MLB_REFRESH_PROFILE === "pulse" ? "pulse" : "full";
const preflightComplete = process.env.MLB_PREFLIGHT_COMPLETE === "true";

const allSteps = [
  ["Decision Center Ownership Check", "node scripts/validate_decision_center_ownership.cjs"],
  ["Canonical Ownership Check", "node scripts/validate_mlb_home_runs_ownership.cjs"],

  ["MLB Today", "node scripts/mlb/fetch_mlb_today.js"],
  ["MLB Player Pool", "node scripts/mlb/build_mlb_player_pool.js"],
  ["Live HR Results", "node scripts/mlb/build_hr_results.js"],
  ["HR Power Profiles", "node scripts/mlb/build_hr_power_profiles.js"],

  ["Pitch Type Damage", "node scripts/mlb/build_pitch_type_damage.js"],
  ["Weather Board", "node scripts/mlb/build_weather_board.js"],
  ["Bullpen Relievers", "node scripts/mlb/build_bullpen_relievers.js"],
  ["Master HR Model", "node scripts/mlb/build_master_hr_model.js"],
  ["Real HR Probability Engine", "node scripts/mlb/build_real_hr_probability_engine.js"],
  ["Market Odds", "node scripts/mlb/build_market_odds.js"],

  ["Game Pitcher Matchups", "node scripts/mlb/build_game_pitcher_matchups.mjs"],
  ["Lineup Impact", "node scripts/mlb/build_lineup_impact_engine.js"],
  ["Statcast Zones", "node scripts/statcast_zone_engine.js"],
  ["Pitcher Attack Zones", "node scripts/mlb/build_pitcher_attack_zones.js"],
  ["Hits Board", "node scripts/mlb/build_hits_board.js"],
  ["Total Bases Board", "node scripts/mlb/build_total_bases_board.js"],
  ["RBI Board", "node scripts/mlb/build_rbi_board.js"],
  ["Pitcher Strikeouts Board", "node scripts/mlb/build_pitcher_strikeouts_board.js"],

  ["HR Decision Center", "node scripts/mlb/build_hr_decision_center.js"],
  ["Final Ownership Check", "node scripts/validate_decision_center_ownership.cjs"],

  ["Player Card Data", "node scripts/build_player_card_data.js"],
  ["Live Change Alerts", "node scripts/mlb/build_live_change_alerts.js"],
  ["AI Breakdowns", "node scripts/build_hr_ai_breakdowns.cjs"],
  ["AI History", "node scripts/build_hr_ai_history.cjs"],
  ["AI Movement", "node scripts/build_hr_ai_movement.cjs"],
  ["AI Trust Engine", "node scripts/build_ai_trust_engine.cjs"],
  ["AI Reasoning Engine", "node scripts/build_ai_reasoning_engine.cjs"],
  ["Tag Registry", "node scripts/build_tag_registry.cjs"],
  ["Public Tags", "node scripts/build_public_tags.cjs"],
  ["AI 2.0", "node scripts/build_ai_2.cjs"],
  ["Health Status", "node scripts/build_health_status.js"]
];

const pulseLabels = new Set([
  "Live HR Results",
  "Weather Board",
  "Market Odds",
  "HR Decision Center",
  "Final Ownership Check",
  "Player Card Data",
  "Live Change Alerts",
  "Public Tags",
  "AI 2.0",
  "Health Status"
]);
const preflightLabels = new Set(["Decision Center Ownership Check", "Canonical Ownership Check", "MLB Today", "MLB Player Pool"]);
const steps = allSteps.filter(([label]) => {
  if (preflightComplete && preflightLabels.has(label)) return false;
  return refreshProfile === "full" || pulseLabels.has(label);
});

const allRequiredOutputs = [
  { file: "mlb_games_today.json", timestampFields: ["updatedAt"] },
  { file: "mlb_player_pool.json", timestampFields: ["updatedAt"] },
  { file: "mlb_player_transactions.json", timestampFields: ["updatedAt"] },
  { file: "mlb_results.json", timestampFields: ["updatedAt"] },
  { file: "hr_power_profiles.json", timestampFields: ["generatedAt"] },
  { file: "game_pitcher_matchups.json", timestampFields: ["updatedAt"] },
  { file: "lineup_impact_engine.json", timestampFields: ["updatedAt"] },
  { file: "pitcher_attack_zones.json", timestampFields: ["updated_at"] },
  { file: "statcast_zones.json", timestampFields: ["updated_at"] },
  { file: "pitcher_vulnerability.json", timestampFields: ["updatedAt"] },
  { file: "mlb_hits.json" },
  { file: "mlb_total_bases.json" },
  { file: "mlb_rbis.json" },
  { file: "mlb_pitcher_strikeouts.json" },
  { file: "pitch_type_damage.json", timestampFields: ["updated_at"] },
  { file: "pitch_type_damage_cache.json" },
  { file: "mlb_weather.json", timestampFields: ["updatedAt"] },
  { file: "bullpen_relievers.json", timestampFields: ["updatedAt"] },
  { file: "mlb_home_runs.json" },
  { file: "hr_probability_tracking.json", timestampFields: ["generatedAt"] },
  { file: "mlb_market_odds.json", timestampFields: ["generatedAt"] },
  { file: "hr_decision_center.json", timestampFields: ["updatedAt"] },
  { file: "player_card_data.json", timestampFields: ["updatedAt"] },
  { file: "live_change_alerts.json", timestampFields: ["generatedAt"] },
  { file: "hr_ai_breakdowns.json", timestampFields: ["updatedAt"] },
  { file: "hr_ai_history.json", timestampFields: ["updatedAt"] },
  { file: "hr_ai_movement.json", timestampFields: ["updatedAt"] },
  { file: "ai_trust_engine.json", timestampFields: ["updatedAt"] },
  { file: "ai_reasoning_engine.json", timestampFields: ["updatedAt"] },
  { file: "tag_registry.json", timestampFields: ["generatedAt"] },
  { file: "public_tags.json", timestampFields: ["generatedAt"] },
  { file: "ai_2.json", timestampFields: ["generatedAt"] },
  { file: "content/x_live_ai_board.json", timestampFields: ["generatedAt"] },
  { file: "health_status.json", timestampFields: ["generatedAt"] }
];

const pulseOutputFiles = new Set([
  "mlb_games_today.json",
  "mlb_player_pool.json",
  "mlb_player_transactions.json",
  "mlb_results.json",
  "mlb_weather.json",
  "mlb_market_odds.json",
  "hr_decision_center.json",
  "player_card_data.json",
  "live_change_alerts.json",
  "public_tags.json",
  "ai_2.json",
  "content/x_live_ai_board.json",
  "health_status.json"
]);
const requiredOutputs = refreshProfile === "full"
  ? allRequiredOutputs
  : allRequiredOutputs.filter(output => pulseOutputFiles.has(output.file));

console.log("");
console.log("THE SLIP LAB FAST REFRESH");
console.log("Time:", new Date().toISOString());
console.log("Profile:", refreshProfile);

if (process.env.MLB_REFRESH_PLAN_ONLY === "true") {
  console.log("Stages:", steps.length);
  for (const [label] of steps) console.log(`- ${label}`);
  process.exit(0);
}

run("Health Status: Updating", "SL_HEALTH_STATE=updating node scripts/build_health_status.js");

for (const [label, command] of steps) {
  run(label, command);
}

const file = "website/data/hr_decision_center.json";

if (!fs.existsSync(file)) {
  console.error("FAILED: hr_decision_center.json does not exist");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));

if (!data.updatedAt) {
  console.error("FAILED: hr_decision_center.json is missing updatedAt");
  process.exit(1);
}

if (!data.sections || typeof data.sections !== "object") {
  console.error("FAILED: Decision Center missing sections object");
  process.exit(1);
}

const requiredSections = [
  "bestPicks",
  "safestPlays",
  "bestValue",
  "lottoBombs",
  "pitchTypeEdges",
  "weatherCarry",
  "bullpenBoosts",
  "ifOnlyOne"
];

for (const section of requiredSections) {
  if (!data.sections[section]) {
    console.error(`FAILED: Decision Center missing section ${section}`);
    process.exit(1);
  }
}

try {
  const outputTimes = new Map(
    requiredOutputs.map(output => [
      output.file,
      validateRebuiltOutput(output)
    ])
  );

  const slateDate = todayEastern();
  validateSlateDate("mlb_games_today.json", "date", slateDate);
  validateSlateDate("mlb_player_pool.json", "date", slateDate);
  validateSlateDate("game_pitcher_matchups.json", "date", slateDate);
  validateSlateDate("pitcher_vulnerability.json", "date", slateDate);
  validateSlateDate("mlb_weather.json", "date", slateDate);
  validateSlateDate("hr_decision_center.json", "pitcherDate", slateDate);
  validateSlateDate("live_change_alerts.json", "date", slateDate);
  validateLiveChangeAlerts(slateDate);
  validatePlayerPoolOwnership();
  validatePitchDamageCache(slateDate);
  validatePitcherVulnerability(slateDate);
  validateRealStatcastZones(slateDate);
  validateRealPitcherAttackZones(slateDate);
  validateHealthStatus(slateDate);
  validateVerifiedPregameReceipts();
  validateCalibrationReport();

  validateDependencyOrder(outputTimes, "mlb_games_today.json", "mlb_player_pool.json");
  validateDependencyOrder(outputTimes, "mlb_player_pool.json", "mlb_player_transactions.json");
  if (refreshProfile === "full") {
    validateDependencyOrder(outputTimes, "mlb_player_pool.json", "mlb_results.json");
    validateDependencyOrder(outputTimes, "mlb_player_pool.json", "hr_power_profiles.json");
    validateDependencyOrder(outputTimes, "mlb_player_pool.json", "pitch_type_damage.json");
    validateDependencyOrder(outputTimes, "mlb_games_today.json", "mlb_weather.json");
    validateDependencyOrder(outputTimes, "hr_power_profiles.json", "mlb_home_runs.json");
    validateDependencyOrder(outputTimes, "pitch_type_damage.json", "mlb_home_runs.json");
    validateDependencyOrder(outputTimes, "mlb_weather.json", "mlb_home_runs.json");
    validateDependencyOrder(outputTimes, "bullpen_relievers.json", "mlb_home_runs.json");
    validateDependencyOrder(outputTimes, "mlb_home_runs.json", "game_pitcher_matchups.json");
    validateDependencyOrder(outputTimes, "mlb_player_pool.json", "game_pitcher_matchups.json");
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
  }
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
} catch (error) {
  console.error("FAILED: refresh freshness validation");
  console.error(error.message);
  process.exit(1);
}

if (!Array.isArray(data.allPlayers)) {
  console.error("FAILED: Decision Center missing allPlayers array");
  process.exit(1);
}

if (!data.pitcherDebug || typeof data.pitcherDebug !== "object") {
  console.error("FAILED: Decision Center missing pitcherDebug");
  process.exit(1);
}

try {
  writeSiteLastUpdated();
} catch (error) {
  console.error("FAILED: site update timestamp");
  console.error(error.message);
  process.exit(1);
}

console.log("");
console.log("FAST REFRESH VALIDATION PASSED");
console.log("Players:", data.allPlayers.length);
console.log("Pitcher Debug:", data.pitcherDebug);
console.log("THE SLIP LAB FAST REFRESH COMPLETE");
