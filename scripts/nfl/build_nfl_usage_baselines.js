import fs from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "website", "data");
const SEASONS = String(process.env.NFL_HISTORY_SEASONS || "2023,2024,2025").split(",").map(Number).filter(Number.isFinite);
const WEIGHTS = new Map([[2023, 0.1], [2024, 0.3], [2025, 0.6]]);

function read(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA, filename), "utf8"));
}

function write(filename, payload) {
  fs.writeFileSync(path.join(DATA, filename), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Built website/data/${filename}`);
}

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      fields.push(value);
      value = "";
    } else value += char;
  }
  fields.push(value);
  return fields;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function canonicalTeam(value) {
  return ({ LA: "LAR", JAC: "JAX", WSH: "WAS" })[value] || value;
}

function emptyWeek({ playerId, playerName, team, season, week }) {
  return {
    playerId, playerName, team, season, week,
    games: new Set(), passAttempts: 0, completions: 0, passingYards: 0, passingTds: 0,
    targets: 0, receptions: 0, receivingYards: 0, receivingTds: 0,
    carries: 0, rushingYards: 0, rushingTds: 0,
    redZoneTargets: 0, inside10Targets: 0, redZoneCarries: 0, inside10Carries: 0
  };
}

function touch(map, identity) {
  const key = `${identity.season}|${identity.week}|${identity.playerId}`;
  if (!map.has(key)) map.set(key, emptyWeek(identity));
  return map.get(key);
}

async function fetchGzip(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url);
    if (response.ok) return gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
    if (attempt === attempts) throw new Error(`NFL history fetch failed (${response.status}): ${url}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  throw new Error(`NFL history fetch failed after retries: ${url}`);
}

async function main() {
  const depth = read("nfl_depth_charts.json");
  const pool = read("nfl_player_pool.json");
  const health = read("nfl_data_health.json");
  const currentByGsis = new Map(depth.entries.filter(entry => entry.gsisId && entry.canonicalPlayerMatch).map(entry => [entry.gsisId, entry]));
  const currentByEspn = new Map(pool.players.map(player => [player.playerId, player]));
  const weeks = new Map();
  const sources = [];
  let playCount = 0;

  for (const season of SEASONS) {
    const url = `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
    const csv = await fetchGzip(url);
    const lines = csv.split(/\r?\n/);
    const headers = parseCsvLine(lines.shift());
    const index = Object.fromEntries(headers.map((header, position) => [header, position]));
    const field = (values, name) => values[index[name]] || "";
    let seasonPlays = 0;

    for (const line of lines) {
      if (!line) continue;
      const values = parseCsvLine(line);
      if (field(values, "season_type") !== "REG") continue;
      const week = number(field(values, "week"));
      const gameId = field(values, "game_id");
      const team = canonicalTeam(field(values, "posteam"));
      const yardline = number(field(values, "yardline_100"));
      const redZone = yardline > 0 && yardline <= 20;
      const inside10 = yardline > 0 && yardline <= 10;
      seasonPlays++;

      const passerId = field(values, "passer_player_id");
      if (passerId && number(field(values, "pass_attempt")) === 1 && number(field(values, "sack")) !== 1) {
        const row = touch(weeks, { playerId: passerId, playerName: field(values, "passer_player_name"), team, season, week });
        row.games.add(gameId);
        row.passAttempts++;
        row.completions += number(field(values, "complete_pass"));
        row.passingYards += number(field(values, "passing_yards"));
        row.passingTds += number(field(values, "pass_touchdown"));
      }

      const receiverId = field(values, "receiver_player_id");
      if (receiverId && number(field(values, "pass_attempt")) === 1) {
        const row = touch(weeks, { playerId: receiverId, playerName: field(values, "receiver_player_name"), team, season, week });
        row.games.add(gameId);
        row.targets++;
        row.receptions += number(field(values, "complete_pass"));
        row.receivingYards += number(field(values, "receiving_yards"));
        row.receivingTds += number(field(values, "pass_touchdown"));
        if (redZone) row.redZoneTargets++;
        if (inside10) row.inside10Targets++;
      }

      const rusherId = field(values, "rusher_player_id");
      if (rusherId && number(field(values, "rush_attempt")) === 1 && number(field(values, "qb_kneel")) !== 1) {
        const row = touch(weeks, { playerId: rusherId, playerName: field(values, "rusher_player_name"), team, season, week });
        row.games.add(gameId);
        row.carries++;
        row.rushingYards += number(field(values, "rushing_yards"));
        row.rushingTds += number(field(values, "rush_touchdown"));
        if (redZone) row.redZoneCarries++;
        if (inside10) row.inside10Carries++;
      }
    }
    playCount += seasonPlays;
    sources.push({ season, url, regularSeasonPlays: seasonPlays });
    console.log(`Processed ${season}: ${seasonPlays} regular-season plays`);
  }

  const weekly = [...weeks.values()].map(row => ({ ...row, games: row.games.size }))
    .sort((a, b) => a.season - b.season || a.week - b.week || a.playerId.localeCompare(b.playerId));
  const byPlayer = new Map();
  for (const row of weekly) {
    if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, []);
    byPlayer.get(row.playerId).push(row);
  }

  const metrics = ["passAttempts", "completions", "passingYards", "passingTds", "targets", "receptions", "receivingYards", "receivingTds", "carries", "rushingYards", "rushingTds", "redZoneTargets", "inside10Targets", "redZoneCarries", "inside10Carries"];
  const profiles = [];
  for (const [gsisId, rows] of byPlayer) {
    const depthEntry = currentByGsis.get(gsisId);
    if (!depthEntry) continue;
    const current = currentByEspn.get(depthEntry.playerId);
    if (!current) continue;
    const seasons = SEASONS.map(season => {
      const seasonRows = rows.filter(row => row.season === season);
      const games = seasonRows.reduce((sum, row) => sum + row.games, 0);
      const totals = Object.fromEntries(metrics.map(metric => [metric, seasonRows.reduce((sum, row) => sum + row[metric], 0)]));
      return { season, games, totals, perGame: Object.fromEntries(metrics.map(metric => [metric, games ? round(totals[metric] / games) : 0])) };
    });
    const available = seasons.filter(row => row.games > 0);
    const totalWeight = available.reduce((sum, row) => sum + (WEIGHTS.get(row.season) || 0), 0);
    const baseline = Object.fromEntries(metrics.map(metric => [metric, round(available.reduce((sum, row) => sum + row.perGame[metric] * (WEIGHTS.get(row.season) || 0), 0) / (totalWeight || 1))]));
    const recent = rows.slice().sort((a, b) => b.season - a.season || b.week - a.week).slice(0, 6);
    const mostRecentRow = recent[0] || null;
    const recentGames = recent.reduce((sum, row) => sum + row.games, 0);
    profiles.push({
      playerId: current.playerId,
      gsisId,
      playerName: current.fullName,
      currentTeam: current.team,
      position: current.position,
      mostRecentHistoricalTeam: mostRecentRow?.team || "",
      currentTeamContinuity: Boolean(mostRecentRow?.team && mostRecentRow.team === current.team),
      depthRank: depthEntry.rank,
      historicalGames: available.reduce((sum, row) => sum + row.games, 0),
      seasons,
      weightedPerGame: baseline,
      recentSixGamesPerGame: Object.fromEntries(metrics.map(metric => [metric, recentGames ? round(recent.reduce((sum, row) => sum + row[metric], 0) / recentGames) : 0])),
      availability: { routes: "unavailable", usageBaseline: "available", currentRoleProjection: "pending" }
    });
  }
  profiles.sort((a, b) => a.currentTeam.localeCompare(b.currentTeam) || a.position.localeCompare(b.position) || a.playerName.localeCompare(b.playerName));

  const generatedAt = new Date().toISOString();
  write("nfl_usage_baselines.json", {
    sport: "NFL", schemaVersion: "1.0", generatedAt,
    seasons: SEASONS, source: "nflverse play-by-play", attribution: "nflverse / nflfastR", license: "CC-BY-4.0",
    methodology: {
      population: "Current 2026 QB/RB/WR/TE players joined to historical GSIS IDs through the validated depth chart.",
      seasonWeights: Object.fromEntries(WEIGHTS),
      exclusions: ["Postseason plays", "QB kneels", "Sacks from pass-attempt totals"],
      routes: "Unavailable from play-by-play and intentionally not estimated."
    },
    sourcePlayCount: playCount,
    weeklyRecordCount: weekly.length,
    profileCount: profiles.length,
    sources,
    profiles
  });

  health.generatedAt = generatedAt;
  health.sources.historicalPlayByPlay = { status: "available", provider: "nflverse / nflfastR", seasons: SEASONS, regularSeasonPlays: playCount };
  health.sources.usageBaselines = { status: "available", provider: "The Slip Lab", playerProfiles: profiles.length };
  health.sources.routes = { status: "unavailable", provider: null, reason: "Routes are not present in play-by-play and are not inferred." };
  health.status = "historical_usage_ready";
  write("nfl_data_health.json", health);
}

main().catch(error => {
  console.error("NFL USAGE BASELINE BUILD FAILED");
  console.error(error);
  process.exit(1);
});
