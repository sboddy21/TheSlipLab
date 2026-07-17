import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA = path.join(__dirname, "../../website/data");
const MAX_REFRESH_AGE_MS = 15 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 1000;

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

  const allowedCategories = new Set(["home_run", "flyout", "lineout", "pop_out", "sac_fly"]);

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

  for (const player of players) {
    const playerId = String(player.playerId || player.mlbId || player.id || "").trim();
    const playerName = String(player.player || "").trim();
    if (!playerId || !playerName) fail("Current player pool contains a player without a name or MLB ID");

    const cached = cache.players[`${playerId}|${expectedDate.slice(0, 4)}`];
    if (!cached || easternDate(cached.cached_at) !== expectedDate) {
      fail(`Pitch damage cache is not current for ${playerName}`);
    }

    if (!Object.prototype.hasOwnProperty.call(damage.players, playerName)) {
      fail(`pitch_type_damage.json is missing ${playerName}`);
    }
  }

  if (Object.keys(damage.players).length !== players.length) {
    fail(`pitch_type_damage.json has ${Object.keys(damage.players).length} players; expected ${players.length}`);
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
  if (monitoring.refreshWindowSeconds !== 900 || freshUntil - generatedAt !== 15 * 60 * 1000) {
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
    const score = Number(row.vulnerability);
    const raw = Number(row.vulnerabilityRaw);
    const weight = Number(row.vulnerabilitySampleWeight);
    const innings = Number(row.vulnerabilityTrueInnings);
    if (!id || byId.has(id)) fail(`pitcher_vulnerability.json has a missing or duplicate pitcher ID ${id || "unknown"}`);
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
      if (!byId.has(id) || Number(pitcher.vulnerability) !== byId.get(id)) {
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

function validateRealStatcastZones(expectedDate) {
  const pool = read("mlb_player_pool.json");
  const matchups = read("game_pitcher_matchups.json");
  const statcast = read("statcast_zones.json");
  const players = Array.isArray(pool.players) ? pool.players : [];
  const pitcherIds = new Set();

  for (const game of matchups.games || []) {
    for (const side of ["away", "home"]) {
      const profile = game[`${side}Pitcher`] || {};
      const pitcherId = profile.id || profile.playerId || game[`${side}ProbablePitcherId`];
      if (!pitcherId) fail(`${game.matchup || game.game || "Current game"} is missing a ${side} pitcher ID`);
      pitcherIds.add(String(pitcherId));
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
    const row = statcast.players[player.player];
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
    if (Number(row.rows) <= 0 || Number(row.zonePitchCount) <= 0) {
      fail(`Statcast pitcher zones have no real sample for ${row.pitcher || pitcherId}`);
    }
    pitchersWithRows++;
    pitchersWithZones++;
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
      for (const hitter of game.hitters?.[side] || []) {
        if (hitter.playerId) matchupByPlayerId.set(String(hitter.playerId), String(pitcher?.id || pitcher?.playerId || ""));
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

  const decisionByPlayer = new Map((decision.allPlayers || []).map(row => [row.player, row]));
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
    const row = attack.players[player.player];
    const pitcherId = matchupByPlayerId.get(String(player.playerId));
    const hitterCard = statcast.players?.[player.player];
    const pitcherCard = statcast.pitchers?.[pitcherId];
    if (!row || !pitcherId || !hitterCard || !pitcherCard) {
      fail(`Real attack-zone dependency is missing for ${player.player}`);
    }
    if (String(row.opposingPitcherId) !== pitcherId) {
      fail(`Attack-zone pitcher mapping is incorrect for ${player.player}`);
    }

    const hitterXwoba = overallXwoba(hitterCard.zones.raw, false);
    const hitterOverall = hitterXwoba === null ? null : Math.min(100, hitterXwoba * 100);
    const pitcherOverall = Math.min(100, overallXwoba(pitcherCard.zones.raw) * 100);
    if (hitterOverall === null ? row.zones?.hitterPower !== null : Math.abs(Number(row.zones?.hitterPower) - roundTo(hitterOverall)) > 0.01) {
      fail(`Attack-zone hitter power is incorrect for ${player.player}`);
    }
    if (row.zones?.qualified !== (hitterOverall !== null)) {
      fail(`Attack-zone qualification is incorrect for ${player.player}`);
    }
    if (Math.abs(Number(row.zones?.pitcherLeak) - roundTo(pitcherOverall)) > 0.01) {
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
    const decisionRow = decisionByPlayer.get(player.player);
    if (!decisionRow || (expectedScore === null
      ? decisionRow.zoneOverlap !== null || decisionRow.zoneSignalAvailable !== false
      : Math.abs(Number(decisionRow.zoneOverlap) - expectedScore) > 0.01)) {
      fail(`Decision Center zone overlap is incorrect for ${player.player}`);
    }
    const expectedPitcherRisk = expectedScore === null ? roundTo(pitcherOverall) : expectedScore;
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
if (Date.now() - refreshAnchor > MAX_REFRESH_AGE_MS) {
  fail(`mlb_games_today.json is older than ${MAX_REFRESH_AGE_MS / 60000} minutes`);
}

const currentOutputs = [
  ["mlb_games_today.json", ["updatedAt"]],
  ["mlb_player_pool.json", ["updatedAt"]],
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
  ["hr_decision_center.json", ["updatedAt"]],
  ["player_card_data.json", ["updatedAt"]],
  ["hr_ai_breakdowns.json", ["updatedAt"]],
  ["hr_ai_history.json", ["updatedAt"]],
  ["hr_ai_movement.json", ["updatedAt"]],
  ["ai_trust_engine.json", ["updatedAt"]],
  ["ai_reasoning_engine.json", ["updatedAt"]],
  ["tag_registry.json", ["generatedAt"]],
  ["public_tags.json", ["generatedAt"]],
  ["ai_2.json", ["generatedAt"]],
  ["hr_ai_hof.json", ["updatedAt"]],
  ["hr_ai_stacks.json", ["updatedAt"]],
  ["health_status.json", ["generatedAt"]],
  ["site_last_updated.json", ["updatedAt", "updated_at"]],
  ["content/x_posts.json", ["updatedAt"]]
];

const outputTimes = new Map();
for (const [file, timestampFields] of currentOutputs) {
  outputTimes.set(file, validateCurrentOutput(file, refreshAnchor, timestampFields));
}

validateDependencyOrder(outputTimes, "mlb_games_today.json", "mlb_player_pool.json");
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
validateDependencyOrder(outputTimes, "tag_registry.json", "public_tags.json");
validateDependencyOrder(outputTimes, "public_tags.json", "ai_2.json");
validateDependencyOrder(outputTimes, "health_status.json", "site_last_updated.json");
validateDependencyOrder(outputTimes, "content/x_posts.json", "site_last_updated.json");

validateSlateDate("mlb_games_today.json", "date", today);
validateSlateDate("mlb_player_pool.json", "date", today);
validateSlateDate("game_pitcher_matchups.json", "date", today);
validateSlateDate("pitcher_vulnerability.json", "date", today);
validateSlateDate("mlb_weather.json", "date", today);
validateSlateDate("hr_decision_center.json", "pitcherDate", today);
validatePitchDamageCache(today);
validatePitcherVulnerability(today);
validatePitcherRateFields();
validateRealStatcastZones(today);
validateRealPitcherAttackZones(today);
validateHealthStatus(today, refreshAnchor);
validatePlayerCardSignals();
validatePlayerResultEvents();

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
