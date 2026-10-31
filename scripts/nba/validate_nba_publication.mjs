import fs from "node:fs";

const DATA_DIR = "website/data";
const BOARD_FILES = [
  "nba_points.json",
  "nba_rebounds.json",
  "nba_assists.json",
  "nba_threes.json",
  "nba_matchup_engine.json"
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(`${DATA_DIR}/${file}`, "utf8"));
}

function playerKey(row) {
  return `${row.gameId}:${row.playerId}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertFiniteRange(value, minimum, maximum, label) {
  assert(Number.isFinite(Number(value)), `${label} is not numeric`);
  assert(Number(value) >= minimum && Number(value) <= maximum, `${label} is outside ${minimum}-${maximum}`);
}

export function validateNbaPublication(payloads) {
  const { slate, pool, availability, minutes, boards } = payloads;
  const games = Array.isArray(slate.games) ? slate.games : [];
  const poolRows = Array.isArray(pool.players) ? pool.players : [];
  const availabilityRows = Array.isArray(availability.players) ? availability.players : [];
  const minutesRows = Array.isArray(minutes.players) ? minutes.players : [];

  const gameIds = new Set(games.map(game => String(game.gameId)));
  const poolMap = new Map(poolRows.map(row => [playerKey(row), row]));
  const availabilityMap = new Map(availabilityRows.map(row => [playerKey(row), row]));
  const eligibleKeys = new Set(minutesRows
    .filter(row => row.publicationEligible && Number(row.expectedMinutes) > 0 && !["OUT", "DOUBTFUL"].includes(row.availabilityStatus))
    .map(playerKey));

  assert(pool.errors?.length === 0, `player pool has ${pool.errors?.length || 0} unresolved roster errors`);
  assert(poolRows.length === Number(pool.playerCount), "player pool count does not match its rows");
  assert(poolMap.size === poolRows.length, "player pool contains duplicate game/player identities");
  assert(availabilityMap.size === poolRows.length, "availability does not cover the full player pool exactly once");
  if (games.length > 0) {
    assert(poolRows.length > 0, "scheduled slate has no players");
    assert(pool.teams?.length === games.length * 2, "scheduled slate does not have two resolved teams per game");
    assert(eligibleKeys.size > 0, "scheduled slate has no publication-eligible players");
  }

  for (const row of poolRows) {
    const key = playerKey(row);
    assert(gameIds.has(String(row.gameId)), `player ${key} belongs to an unknown game`);
    assert(row.playerId && row.player && row.teamAbbr && row.opponentAbbr, `player ${key} has incomplete identity data`);
    const status = availabilityMap.get(key);
    assert(status, `player ${key} has no availability record`);
    assert(String(status.player) === String(row.player), `player ${key} has conflicting identity data`);
    assert(String(status.team) === String(row.teamAbbr), `player ${key} has conflicting team data`);
  }

  let referenceKeys;
  const boardCounts = {};
  for (const [file, payload] of Object.entries(boards)) {
    const rows = Array.isArray(payload.players) ? payload.players : [];
    const keys = new Set(rows.map(playerKey));
    boardCounts[file] = rows.length;
    assert(keys.size === rows.length, `${file} contains duplicate game/player identities`);
    assert(rows.length === eligibleKeys.size, `${file} published ${rows.length} players; expected ${eligibleKeys.size} verified players`);

    for (const row of rows) {
      const key = playerKey(row);
      const canonical = poolMap.get(key);
      const status = availabilityMap.get(key);
      assert(canonical, `${file} contains unknown player ${key}`);
      assert(eligibleKeys.has(key), `${file} contains unverified player ${key}`);
      assert(row.publicationEligible === true, `${file} contains context-only player ${key}`);
      assert(String(row.player) === String(canonical.player), `${file} has conflicting name for ${key}`);
      assert(String(row.team) === String(canonical.teamAbbr), `${file} has conflicting team for ${key}`);
      assert(String(row.opponent) === String(canonical.opponentAbbr), `${file} has conflicting opponent for ${key}`);
      assert(String(row.availabilityStatus) === String(status.availabilityStatus), `${file} has stale availability for ${key}`);
      assertFiniteRange(row.expectedMinutes, 0, 48, `${file} expectedMinutes for ${key}`);
      if (row.minutesConfidence !== undefined) assertFiniteRange(row.minutesConfidence, 0, 100, `${file} minutesConfidence for ${key}`);
      for (const field of ["pointsScore", "reboundsScore", "assistsScore", "threesScore", "matchupScore"]) {
        if (row[field] !== undefined) assertFiniteRange(row[field], 0, 100, `${file} ${field} for ${key}`);
      }
    }

    if (!referenceKeys) referenceKeys = keys;
    else assert([...referenceKeys].every(key => keys.has(key)), `${file} does not publish the same verified player set as the other boards`);
  }

  return {
    status: "passed",
    verifiedAt: new Date().toISOString(),
    date: slate.date,
    gameCount: games.length,
    rosterPlayerCount: poolRows.length,
    availabilityPlayerCount: availabilityRows.length,
    publicationEligibleCount: eligibleKeys.size,
    boardCounts,
    checks: [
      "current slate identities",
      "complete roster resolution",
      "complete availability coverage",
      "cross-board player consistency",
      "team and opponent consistency",
      "publication eligibility",
      "projection numeric bounds"
    ]
  };
}

export function validateGeneratedNbaPublication() {
  return validateNbaPublication({
    slate: readJson("nba_games_today.json"),
    pool: readJson("nba_player_pool.json"),
    availability: readJson("nba_availability.json"),
    minutes: readJson("nba_minutes_engine.json"),
    boards: Object.fromEntries(BOARD_FILES.map(file => [file, readJson(file)]))
  });
}
