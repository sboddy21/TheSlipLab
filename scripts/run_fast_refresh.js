import { spawnSync } from "child_process";
import fs from "fs";

const REFRESH_STARTED_AT = Date.now();
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

function validateDependencyOrder(times, before, after) {
  if (times.get(before) > times.get(after)) {
    throw new Error(`${before} was written after dependent output ${after}`);
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

  for (const player of players) {
    const playerId = String(player.playerId || player.mlbId || player.id || "").trim();
    const playerName = String(player.player || "").trim();
    if (!playerId || !playerName) {
      throw new Error(`Current player pool contains a player without a name or MLB ID`);
    }

    const cached = cache.players[`${playerId}|${expectedDate.slice(0, 4)}`];
    if (!cached || easternDate(cached.cached_at) !== expectedDate) {
      throw new Error(`Pitch damage cache is not current for ${playerName}`);
    }

    if (!Object.prototype.hasOwnProperty.call(damage.players, playerName)) {
      throw new Error(`pitch_type_damage.json is missing ${playerName}`);
    }
  }

  if (Object.keys(damage.players).length !== players.length) {
    throw new Error(
      `pitch_type_damage.json has ${Object.keys(damage.players).length} players; expected ${players.length}`
    );
  }
}

function validateHealthStatus(expectedDate) {
  const health = readJson(outputPath("health_status.json"));
  const updatedAt = Date.parse(health.updatedAt);

  if (health.status !== "healthy" || health.label !== "LIVE") {
    throw new Error(`health_status.json is not healthy: ${(health.errors || []).join(" | ") || "unknown error"}`);
  }

  if (health.source !== "mlb_fast_refresh") {
    throw new Error(`health_status.json has unexpected source ${health.source || "missing"}`);
  }

  if (!Number.isFinite(updatedAt) || updatedAt < REFRESH_STARTED_AT - 1000) {
    throw new Error("health_status.json updatedAt does not belong to the current refresh");
  }

  const games = readJson(outputPath("mlb_games_today.json"));
  if (games.date !== expectedDate) {
    throw new Error(`Health status is not tied to the ${expectedDate} slate`);
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
      if (!pitcherId) throw new Error(`${game.matchup || game.game || "Current game"} is missing a ${side} pitcher ID`);
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
    const row = statcast.players[player.player];
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
    if (Number(row.rows) <= 0 || Number(row.zonePitchCount) <= 0) {
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
  if (Number(statcast.pitchersWithRows) !== pitcherIds.size || Number(statcast.pitchersWithZones) !== pitcherIds.size) {
    throw new Error("Statcast pitcher coverage is incomplete");
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
      for (const hitter of game.hitters?.[side] || []) {
        if (hitter.playerId) matchupByPlayerId.set(String(hitter.playerId), String(pitcher?.id || pitcher?.playerId || ""));
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

  const decisionByPlayer = new Map((decision.allPlayers || []).map(row => [row.player, row]));
  const roundTo = (value, places = 2) => {
    const mult = 10 ** places;
    return Math.round(Number(value) * mult) / mult;
  };
  const overallXwoba = raw => {
    const total = raw.reduce((sum, cell) => sum + Number(cell?.xwobaTotal || 0), 0);
    const count = raw.reduce((sum, cell) => sum + Number(cell?.xwobaCount || 0), 0);
    if (!count) throw new Error("Real attack-zone validation found a profile without xwOBA samples");
    return total / count;
  };

  for (const player of hr) {
    const row = attack.players[player.player];
    const pitcherId = matchupByPlayerId.get(String(player.playerId));
    const hitterCard = statcast.players?.[player.player];
    const pitcherCard = statcast.pitchers?.[pitcherId];
    if (!row || !pitcherId || !hitterCard || !pitcherCard) {
      throw new Error(`Real attack-zone dependency is missing for ${player.player}`);
    }
    if (String(row.opposingPitcherId) !== pitcherId) {
      throw new Error(`Attack-zone pitcher mapping is incorrect for ${player.player}`);
    }

    const hitterOverall = Math.min(100, overallXwoba(hitterCard.zones.raw) * 100);
    const pitcherOverall = Math.min(100, overallXwoba(pitcherCard.zones.raw) * 100);
    if (Math.abs(Number(row.zones?.hitterPower) - roundTo(hitterOverall)) > 0.01) {
      throw new Error(`Attack-zone hitter power is incorrect for ${player.player}`);
    }
    if (Math.abs(Number(row.zones?.pitcherLeak) - roundTo(pitcherOverall)) > 0.01) {
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

    const avgOverlap = qualifiedCount ? overlapTotal / qualifiedCount : 0;
    const expectedScore = roundTo(Math.max(0, Math.min(100,
      roundTo(hitterOverall) * 0.34 +
      roundTo(pitcherOverall) * 0.34 +
      avgOverlap * 0.22 +
      hotCount * 1.8
    )));
    const decisionRow = decisionByPlayer.get(player.player);
    if (!decisionRow || Math.abs(Number(decisionRow.zoneOverlap) - expectedScore) > 0.01) {
      throw new Error(`Decision Center zone overlap is incorrect for ${player.player}`);
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

const steps = [
  ["Decision Center Ownership Check", "node scripts/validate_decision_center_ownership.cjs"],
  ["Canonical Ownership Check", "node scripts/validate_mlb_home_runs_ownership.cjs"],

  ["MLB Today", "node scripts/mlb/fetch_mlb_today.js"],
  ["MLB Player Pool", "node scripts/mlb/build_mlb_player_pool.js"],
  ["HR Power Profiles", "node scripts/mlb/build_hr_power_profiles.js"],

  ["Pitch Type Damage", "node scripts/mlb/build_pitch_type_damage.js"],
  ["Weather Board", "node scripts/mlb/build_weather_board.js"],
  ["Bullpen Relievers", "node scripts/mlb/build_bullpen_relievers.js"],
  ["Master HR Model", "node scripts/mlb/build_master_hr_model.js"],
  ["Real HR Probability Engine", "node scripts/mlb/build_real_hr_probability_engine.js"],

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
  ["AI Breakdowns", "node scripts/build_hr_ai_breakdowns.cjs"],
  ["AI History", "node scripts/build_hr_ai_history.cjs"],
  ["AI Movement", "node scripts/build_hr_ai_movement.cjs"],
  ["AI Trust Engine", "node scripts/build_ai_trust_engine.cjs"],
  ["AI Reasoning Engine", "node scripts/build_ai_reasoning_engine.cjs"],
  ["Tag Registry", "node scripts/build_tag_registry.cjs"],
  ["Public Tags", "node scripts/build_public_tags.cjs"],
  ["AI 2.0", "node scripts/build_ai_2.cjs"],
  ["AI Hall of Fame", "node scripts/build_hr_ai_hof.cjs"],
  ["AI Stacks", "node scripts/build_hr_ai_stacks.cjs"],
  ["Health Status", "node scripts/build_health_status.js"],
  ["X Content", "node scripts/build_x_content.js"]
];

const requiredOutputs = [
  { file: "mlb_games_today.json", timestampFields: ["updatedAt"] },
  { file: "mlb_player_pool.json", timestampFields: ["updatedAt"] },
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
  { file: "hr_decision_center.json", timestampFields: ["updatedAt"] },
  { file: "player_card_data.json", timestampFields: ["updatedAt"] },
  { file: "hr_ai_breakdowns.json", timestampFields: ["updatedAt"] },
  { file: "hr_ai_history.json", timestampFields: ["updatedAt"] },
  { file: "hr_ai_movement.json", timestampFields: ["updatedAt"] },
  { file: "ai_trust_engine.json", timestampFields: ["updatedAt"] },
  { file: "ai_reasoning_engine.json", timestampFields: ["updatedAt"] },
  { file: "tag_registry.json", timestampFields: ["generatedAt"] },
  { file: "public_tags.json", timestampFields: ["generatedAt"] },
  { file: "ai_2.json", timestampFields: ["generatedAt"] },
  { file: "hr_ai_hof.json", timestampFields: ["updatedAt"] },
  { file: "hr_ai_stacks.json", timestampFields: ["updatedAt"] },
  { file: "health_status.json", timestampFields: ["generatedAt"] },
  { file: "website/data/content/x_posts.json", timestampFields: ["updatedAt"] },
  { file: "exports/content/x_posts.txt" }
];

console.log("");
console.log("THE SLIP LAB FAST REFRESH");
console.log("Time:", new Date().toISOString());

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
  validatePitchDamageCache(slateDate);
  validateRealStatcastZones(slateDate);
  validateRealPitcherAttackZones(slateDate);
  validateHealthStatus(slateDate);

  validateDependencyOrder(outputTimes, "mlb_games_today.json", "mlb_player_pool.json");
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
