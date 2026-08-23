import fs from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../website/data");
const SEASONS = String(process.env.NFL_CONTEXT_SEASONS || "2023,2024,2025").split(",").map(Number).filter(Number.isFinite);
const WEIGHTS = new Map([[2023, 0.1], [2024, 0.3], [2025, 0.6]]);
const CACHE_HOURS = Number(process.env.NFL_CONTEXT_CACHE_HOURS || 18);
const read = filename => JSON.parse(fs.readFileSync(path.join(DATA, filename), "utf8"));
const write = (filename, payload) => fs.writeFileSync(path.join(DATA, filename), `${JSON.stringify(payload, null, 2)}\n`);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
};
const canonicalTeam = value => ({ LA: "LAR", JAC: "JAX", WAS: "WSH" })[value] || value;

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { fields.push(value); value = ""; }
    else value += char;
  }
  fields.push(value);
  return fields;
}

async function fetchGzip(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url);
    if (response.ok) return gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
    if (attempt === attempts) throw new Error(`NFL matchup history fetch failed (${response.status}): ${url}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  throw new Error(`NFL matchup history fetch failed after retries: ${url}`);
}

async function fetchText(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.text();
    if (attempt === attempts) throw new Error(`NFL matchup reference fetch failed (${response.status}): ${url}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  throw new Error(`NFL matchup reference fetch failed after retries: ${url}`);
}

function emptyTeam(team, season) {
  return {
    team, season, games: new Set(), offensivePlays: 0, defensivePlays: 0,
    offensiveTouchdowns: 0, rushingTouchdowns: 0, receivingTouchdowns: 0,
    touchdownsAllowed: 0, rushingTouchdownsAllowed: 0, receivingTouchdownsAllowed: 0,
    rbTouchdownsAllowed: 0, wrTouchdownsAllowed: 0, teTouchdownsAllowed: 0, qbRushingTouchdownsAllowed: 0,
    positionMappedTouchdowns: 0, touchdownPlays: 0,
    offensiveRedZoneDrives: new Set(), defensiveRedZoneDrives: new Set(),
    offensiveRedZoneTouchdowns: 0, defensiveRedZoneTouchdowns: 0,
    offensiveInside5Attempts: 0, offensiveInside5Touchdowns: 0,
    defensiveInside5Attempts: 0, defensiveInside5Touchdowns: 0
  };
}

function teamRow(map, team, season) {
  const key = `${season}|${team}`;
  if (!map.has(key)) map.set(key, emptyTeam(team, season));
  return map.get(key);
}

function rate(value, games) { return games ? round(value / games) : 0; }

async function buildHistoricalBaselines(depth) {
  const playerUrl = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
  const playerCsv = await fetchText(playerUrl);
  const playerLines = playerCsv.split(/\r?\n/);
  const playerHeaders = parseCsvLine(playerLines.shift());
  const playerIndex = Object.fromEntries(playerHeaders.map((header, position) => [header, position]));
  const positionByGsis = new Map();
  for (const line of playerLines) {
    if (!line) continue;
    const values = parseCsvLine(line);
    const gsisId = values[playerIndex.gsis_id];
    const position = values[playerIndex.position_group] || values[playerIndex.position];
    if (gsisId && ["QB", "RB", "WR", "TE"].includes(position)) positionByGsis.set(gsisId, position);
  }
  for (const entry of depth.entries) if (entry.gsisId) positionByGsis.set(entry.gsisId, entry.position);
  const teamSeasons = new Map();
  const sources = [];

  for (const season of SEASONS) {
    const url = `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
    const csv = await fetchGzip(url);
    const lines = csv.split(/\r?\n/);
    const headers = parseCsvLine(lines.shift());
    const index = Object.fromEntries(headers.map((header, position) => [header, position]));
    const field = (values, name) => index[name] === undefined ? "" : values[index[name]] || "";
    let plays = 0;

    for (const line of lines) {
      if (!line) continue;
      const values = parseCsvLine(line);
      if (field(values, "season_type") !== "REG") continue;
      const offense = canonicalTeam(field(values, "posteam"));
      const defense = canonicalTeam(field(values, "defteam"));
      const gameId = field(values, "game_id");
      if (!offense || !defense || !gameId) continue;
      const off = teamRow(teamSeasons, offense, season);
      const def = teamRow(teamSeasons, defense, season);
      off.games.add(gameId); def.games.add(gameId);
      const playType = field(values, "play_type");
      const scrimmagePlay = ["run", "pass"].includes(playType) && number(field(values, "qb_kneel")) !== 1 && number(field(values, "qb_spike")) !== 1;
      if (scrimmagePlay) { off.offensivePlays++; def.defensivePlays++; plays++; }
      const yardline = number(field(values, "yardline_100"));
      const drive = field(values, "drive");
      if (yardline > 0 && yardline <= 20 && drive) {
        off.offensiveRedZoneDrives.add(`${gameId}|${drive}`);
        def.defensiveRedZoneDrives.add(`${gameId}|${drive}`);
      }
      const rushAttempt = number(field(values, "rush_attempt")) === 1 && number(field(values, "qb_kneel")) !== 1;
      const passAttempt = number(field(values, "pass_attempt")) === 1 && number(field(values, "sack")) !== 1;
      const touchdown = number(field(values, "touchdown")) === 1;
      const rushTouchdown = number(field(values, "rush_touchdown")) === 1;
      const passTouchdown = number(field(values, "pass_touchdown")) === 1;
      if (yardline > 0 && yardline <= 5 && (rushAttempt || passAttempt)) {
        off.offensiveInside5Attempts++; def.defensiveInside5Attempts++;
        if (touchdown) { off.offensiveInside5Touchdowns++; def.defensiveInside5Touchdowns++; }
      }
      if (!rushTouchdown && !passTouchdown) continue;
      off.offensiveTouchdowns++; def.touchdownsAllowed++;
      if (yardline > 0 && yardline <= 20) { off.offensiveRedZoneTouchdowns++; def.defensiveRedZoneTouchdowns++; }
      off.touchdownPlays++; def.touchdownPlays++;
      if (rushTouchdown) { off.rushingTouchdowns++; def.rushingTouchdownsAllowed++; }
      if (passTouchdown) { off.receivingTouchdowns++; def.receivingTouchdownsAllowed++; }
      const scorerId = rushTouchdown ? field(values, "rusher_player_id") : field(values, "receiver_player_id");
      const position = positionByGsis.get(scorerId);
      if (!position) continue;
      def.positionMappedTouchdowns++;
      if (position === "RB") def.rbTouchdownsAllowed++;
      if (position === "WR") def.wrTouchdownsAllowed++;
      if (position === "TE") def.teTouchdownsAllowed++;
      if (position === "QB" && rushTouchdown) def.qbRushingTouchdownsAllowed++;
    }
    sources.push({ season, url, regularSeasonScrimmagePlays: plays });
  }

  const seasonRows = [...teamSeasons.values()].map(row => {
    const games = row.games.size;
    const positionCoverage = row.touchdownPlays ? row.positionMappedTouchdowns / row.touchdownPlays : 0;
    const positionRate = value => positionCoverage ? round((value / games) / positionCoverage) : 0;
    return {
      team: row.team, season: row.season, games,
      offense: {
        playsPerGame: rate(row.offensivePlays, games),
        touchdownsPerGame: rate(row.offensiveTouchdowns, games),
        rushingTouchdownsPerGame: rate(row.rushingTouchdowns, games),
        receivingTouchdownsPerGame: rate(row.receivingTouchdowns, games),
        redZoneDrivesPerGame: rate(row.offensiveRedZoneDrives.size, games),
        redZoneTdRate: row.offensiveRedZoneDrives.size ? round(row.offensiveRedZoneTouchdowns / row.offensiveRedZoneDrives.size) : 0,
        inside5TdRate: row.offensiveInside5Attempts ? round(row.offensiveInside5Touchdowns / row.offensiveInside5Attempts) : 0
      },
      defense: {
        playsPerGame: rate(row.defensivePlays, games),
        touchdownsAllowedPerGame: rate(row.touchdownsAllowed, games),
        rushingTouchdownsAllowedPerGame: rate(row.rushingTouchdownsAllowed, games),
        receivingTouchdownsAllowedPerGame: rate(row.receivingTouchdownsAllowed, games),
        rbTouchdownsAllowedPerGame: positionRate(row.rbTouchdownsAllowed),
        wrTouchdownsAllowedPerGame: positionRate(row.wrTouchdownsAllowed),
        teTouchdownsAllowedPerGame: positionRate(row.teTouchdownsAllowed),
        qbRushingTouchdownsAllowedPerGame: positionRate(row.qbRushingTouchdownsAllowed),
        redZoneDrivesAllowedPerGame: rate(row.defensiveRedZoneDrives.size, games),
        redZoneTdRateAllowed: row.defensiveRedZoneDrives.size ? round(row.defensiveRedZoneTouchdowns / row.defensiveRedZoneDrives.size) : 0,
        inside5TdRateAllowed: row.defensiveInside5Attempts ? round(row.defensiveInside5Touchdowns / row.defensiveInside5Attempts) : 0,
        scorerPositionCoverage: round(positionCoverage)
      }
    };
  });

  const metrics = {
    offense: ["playsPerGame", "touchdownsPerGame", "rushingTouchdownsPerGame", "receivingTouchdownsPerGame", "redZoneDrivesPerGame", "redZoneTdRate", "inside5TdRate"],
    defense: ["playsPerGame", "touchdownsAllowedPerGame", "rushingTouchdownsAllowedPerGame", "receivingTouchdownsAllowedPerGame", "rbTouchdownsAllowedPerGame", "wrTouchdownsAllowedPerGame", "teTouchdownsAllowedPerGame", "qbRushingTouchdownsAllowedPerGame", "redZoneDrivesAllowedPerGame", "redZoneTdRateAllowed", "inside5TdRateAllowed", "scorerPositionCoverage"]
  };
  const teams = [...new Set(seasonRows.map(row => row.team))].sort();
  const weighted = teams.map(team => {
    const rows = seasonRows.filter(row => row.team === team && row.games > 0);
    const totalWeight = rows.reduce((sum, row) => sum + (WEIGHTS.get(row.season) || 0), 0) || 1;
    const blend = side => Object.fromEntries(metrics[side].map(metric => [metric, round(rows.reduce((sum, row) => sum + row[side][metric] * (WEIGHTS.get(row.season) || 0), 0) / totalWeight)]));
    return { team, offense: blend("offense"), defense: blend("defense"), seasons: rows.map(row => ({ season: row.season, games: row.games })) };
  });
  sources.unshift({ type: "player_positions", url: playerUrl, mappedPlayers: positionByGsis.size });
  return { builtAt: new Date().toISOString(), seasons: SEASONS, weights: Object.fromEntries(WEIGHTS), sources, teamBaselines: weighted };
}

function percentileMap(rows, metric) {
  const sorted = rows.slice().sort((a, b) => number(a.defense[metric]) - number(b.defense[metric]));
  return new Map(sorted.map((row, index) => [row.team, sorted.length > 1 ? round(index / (sorted.length - 1) * 100, 1) : 50]));
}

function mainWeek(schedule) {
  const weeks = [...new Set(schedule.games.map(game => game.week))].sort((a, b) => a - b);
  return weeks.find(week => schedule.games.some(game => game.week === week && Date.parse(game.kickoffUTC) >= Date.now())) || weeks[weeks.length - 1];
}

async function main() {
  const schedule = read("nfl_schedule.json");
  const pool = read("nfl_player_pool.json");
  const depth = read("nfl_depth_charts.json");
  const health = read("nfl_data_health.json");
  const outputPath = path.join(DATA, "nfl_matchup_context.json");
  const existing = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, "utf8")) : null;
  const cacheAgeHours = existing?.historicalBuiltAt ? (Date.now() - Date.parse(existing.historicalBuiltAt)) / 36e5 : Infinity;
  const history = existing?.historicalTeamBaselines?.length === 32 && cacheAgeHours <= CACHE_HOURS
    ? { builtAt: existing.historicalBuiltAt, seasons: existing.historicalSeasons, weights: existing.historicalWeights, sources: existing.historicalSources, teamBaselines: existing.historicalTeamBaselines }
    : await buildHistoricalBaselines(depth);
  const week = mainWeek(schedule);
  const games = schedule.games.filter(game => game.week === week && game.state === "pre" && !game.completed);
  const gameByTeam = new Map();
  for (const game of games) {
    for (const [team, opponent, homeAway] of [[game.homeTeam.abbreviation, game.awayTeam.abbreviation, "home"], [game.awayTeam.abbreviation, game.homeTeam.abbreviation, "away"]]) {
      if (gameByTeam.has(team)) throw new Error(`Team ${team} is assigned to multiple Week ${week} games`);
      gameByTeam.set(team, { gameId: game.gameId, opponent, homeAway, kickoffUTC: game.kickoffUTC, venue: game.venue, indoor: game.indoor, neutralSite: game.neutralSite });
    }
  }
  if (gameByTeam.size !== 32) throw new Error(`Expected 32 Week ${week} team assignments, received ${gameByTeam.size}`);
  const baselineByTeam = new Map(history.teamBaselines.map(row => [row.team, row]));
  const leagueTdAverage = round(history.teamBaselines.reduce((sum, row) => sum + row.offense.touchdownsPerGame, 0) / history.teamBaselines.length);
  const leaguePaceAverage = round(history.teamBaselines.reduce((sum, row) => sum + row.offense.playsPerGame, 0) / history.teamBaselines.length);
  const percentiles = {
    RB: percentileMap(history.teamBaselines, "rbTouchdownsAllowedPerGame"),
    WR: percentileMap(history.teamBaselines, "wrTouchdownsAllowedPerGame"),
    TE: percentileMap(history.teamBaselines, "teTouchdownsAllowedPerGame"),
    QB: percentileMap(history.teamBaselines, "qbRushingTouchdownsAllowedPerGame")
  };
  const teamContexts = [...gameByTeam.entries()].map(([team, assignment]) => {
    const own = baselineByTeam.get(team);
    const opponent = baselineByTeam.get(assignment.opponent);
    if (!own || !opponent) throw new Error(`Missing historical context for ${team} vs ${assignment.opponent}`);
    const homeAdjustment = assignment.neutralSite ? 0 : assignment.homeAway === "home" ? 0.08 : -0.08;
    const projectedTeamTouchdownsBaseline = round(own.offense.touchdownsPerGame * 0.55 + opponent.defense.touchdownsAllowedPerGame * 0.45 + homeAdjustment, 2);
    const paceIndex = round(((own.offense.playsPerGame + opponent.defense.playsPerGame) / 2) / leaguePaceAverage * 100, 1);
    return {
      team, ...assignment,
      assignmentStatus: "verified_regular_season_schedule",
      scoringEnvironment: {
        status: "historical_baseline_only_no_market",
        projectedTeamTouchdownsBaseline,
        leagueTouchdownsPerGame: leagueTdAverage,
        paceIndex,
        expectedGameScript: "unavailable_until_verified_spread",
        impliedTeamTotal: null,
        spread: null,
        gameTotal: null
      },
      offense: own.offense,
      opponentDefense: {
        ...opponent.defense,
        vulnerabilityPercentileByPosition: Object.fromEntries(Object.entries(percentiles).map(([position, map]) => [position, map.get(assignment.opponent) ?? null])),
        status: opponent.defense.scorerPositionCoverage >= 0.7 ? "available_with_position_coverage" : "partial_position_coverage"
      }
    };
  }).sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC) || a.team.localeCompare(b.team));
  const teamContextByTeam = new Map(teamContexts.map(row => [row.team, row]));
  const playerAssignments = pool.players.map(player => {
    const context = teamContextByTeam.get(player.team);
    if (!context) throw new Error(`No Week ${week} game assignment for ${player.fullName} (${player.team})`);
    return { playerId: player.playerId, playerName: player.fullName, team: player.team, position: player.position, gameId: context.gameId, opponent: context.opponent, homeAway: context.homeAway };
  });
  const duplicatePlayers = playerAssignments.filter((row, index, all) => all.findIndex(other => other.playerId === row.playerId) !== index);
  if (duplicatePlayers.length) throw new Error(`Duplicate player matchup assignments: ${duplicatePlayers.slice(0, 5).map(row => row.playerId).join(", ")}`);
  const generatedAt = new Date().toISOString();
  const payload = {
    sport: "NFL", schemaVersion: "1.0", season: schedule.season, generatedAt,
    status: "private_week_matchup_context", week,
    contextType: "historical_baseline_without_sportsbook_or_weather",
    historicalBuiltAt: history.builtAt, historicalSeasons: history.seasons, historicalWeights: history.weights, historicalSources: history.sources,
    methodology: {
      projectedTeamTouchdownsBaseline: "55% weighted team offensive TD/game plus 45% opponent defensive TD allowed/game, with a small non-neutral home/away adjustment.",
      paceIndex: "Team offensive plays/game blended with opponent defensive plays/game and indexed to league average 100.",
      defensiveVulnerability: "Percentile rank of weighted TDs allowed per game to the player position; scorer-position rates are coverage-normalized and higher is more vulnerable.",
      warning: "These are matchup context scores, not touchdown probabilities. Market-implied totals, spread, weather, and confirmed Week 1 roles remain unavailable."
    },
    freshness: { historicalCacheHours: CACHE_HOURS, historicalAgeHours: round((Date.now() - Date.parse(history.builtAt)) / 36e5, 2) },
    counts: { games: games.length, teamContexts: teamContexts.length, playerAssignments: playerAssignments.length, duplicatePlayerAssignments: 0, missingTeamAssignments: 0 },
    games: games.map(game => ({ gameId: game.gameId, week: game.week, kickoffUTC: game.kickoffUTC, venue: game.venue, indoor: game.indoor, neutralSite: game.neutralSite, homeTeam: game.homeTeam.abbreviation, awayTeam: game.awayTeam.abbreviation })),
    teamContexts, playerAssignments,
    historicalTeamBaselines: history.teamBaselines
  };
  write("nfl_matchup_context.json", payload);
  health.generatedAt = generatedAt;
  health.sources.matchupContext = { status: "available_historical_baseline", provider: "The Slip Lab / nflverse", week, games: games.length, teamContexts: teamContexts.length, playerAssignments: playerAssignments.length, historicalBuiltAt: history.builtAt };
  health.status = "matchup_context_ready_projections_gated";
  write("nfl_data_health.json", health);
  console.log(`Built NFL Week ${week} matchup context: ${games.length} games, ${playerAssignments.length} player assignments`);
}

main().catch(error => {
  console.error("NFL MATCHUP CONTEXT BUILD FAILED");
  console.error(error);
  process.exit(1);
});
