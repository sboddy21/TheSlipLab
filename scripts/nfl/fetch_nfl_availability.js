import fs from "fs";
import { depthMatchesPlayer } from "./launch_safety.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "website", "data");
const SEASON = Number(process.env.NFL_SEASON || 2026);
const DEPTH_URL = `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${SEASON}.csv`;
const TARGET_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

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
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  fields.push(value);
  return fields;
}

async function fetchText(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.text();
    if (attempt === attempts) throw new Error(`NFL availability fetch failed (${response.status}): ${url}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  throw new Error(`NFL availability fetch failed after retries: ${url}`);
}

async function main() {
  const pool = read("nfl_player_pool.json");
  const health = read("nfl_data_health.json");
  const playersById = new Map(pool.players.map(player => [String(player.playerId), player]));
  const csv = await fetchText(DEPTH_URL);
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift());
  const rows = lines.map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });

  const latestByTeam = new Map();
  for (const row of rows) {
    if (!row.team || !row.dt) continue;
    const current = latestByTeam.get(row.team);
    if (!current || Date.parse(row.dt) > Date.parse(current)) latestByTeam.set(row.team, row.dt);
  }

  const latest = rows.filter(row => row.dt === latestByTeam.get(row.team) && TARGET_POSITIONS.has(row.pos_abb));
  const depthEntries = latest.map(row => {
    const player = playersById.get(String(row.espn_id));
    const team = ({ LA: "LAR", WAS: "WSH" })[row.team] || row.team;
    return {
      playerId: String(row.espn_id || ""),
      gsisId: row.gsis_id || "",
      playerName: row.player_name || player?.fullName || "",
      team: team || "",
      position: row.pos_abb || player?.position || "",
      positionName: row.pos_name || "",
      positionGroup: row.pos_grp || "",
      slot: Number(row.pos_slot || 0),
      rank: Number(row.pos_rank || 0),
      starter: Number(row.pos_rank || 0) === 1,
      snapshotAt: row.dt,
      canonicalPlayerMatch: depthMatchesPlayer({ playerId: String(row.espn_id || ""), team, position: row.pos_abb }, player)
    };
  }).sort((a, b) => a.team.localeCompare(b.team) || a.position.localeCompare(b.position) || a.slot - b.slot || a.rank - b.rank);

  const injuryEntries = pool.players.flatMap(player => (player.injuries || []).map(injury => ({
    playerId: player.playerId,
    playerName: player.fullName,
    team: player.team,
    position: player.position,
    status: injury.status || "reported",
    type: injury.type || "",
    detail: injury.detail || "",
    reportedAt: injury.date || "",
    sourceCoverage: "team_roster_feed"
  }))).sort((a, b) => a.team.localeCompare(b.team) || a.playerName.localeCompare(b.playerName));

  const generatedAt = new Date().toISOString();
  const unmatched = depthEntries.filter(entry => !entry.canonicalPlayerMatch);
  const resolvedDepthEntries = depthEntries.filter(entry => entry.canonicalPlayerMatch);
  const snapshots = [...latestByTeam.values()].map(Date.parse).filter(Number.isFinite);
  const newestSnapshotAt = snapshots.length ? new Date(Math.max(...snapshots)).toISOString() : null;
  const oldestSnapshotAt = snapshots.length ? new Date(Math.min(...snapshots)).toISOString() : null;

  write("nfl_depth_charts.json", {
    sport: "NFL", schemaVersion: "1.0", season: SEASON, generatedAt,
    source: "nflverse depth charts (ESPN-derived)", sourceUrl: DEPTH_URL,
    attribution: "nflverse; depth-chart source data derived from ESPN",
    license: "CC-BY-SA-4.0",
    availability: resolvedDepthEntries.length ? "available" : "unavailable",
    teamCount: new Set(resolvedDepthEntries.map(entry => entry.team)).size,
    entryCount: resolvedDepthEntries.length,
    matchedPlayerCount: resolvedDepthEntries.length,
    unmatchedPlayerCount: 0,
    sourceUnmatchedExcludedCount: unmatched.length,
    excludedSourceEntries: unmatched.map(entry => ({ ...entry, resolution: "excluded_not_in_current_roster_pool" })),
    oldestSnapshotAt,
    newestSnapshotAt,
    entries: resolvedDepthEntries
  });

  write("nfl_injuries.json", {
    sport: "NFL", schemaVersion: "1.0", season: SEASON, generatedAt,
    source: "ESPN NFL team roster feeds",
    availability: "partial",
    coverage: "Roster-reported injuries only during preseason; official weekly practice reports are not yet active.",
    freshnessPolicy: {
      maximumAgeHours: 24,
      missingReportMeaning: "No injury was attached to the player in the latest roster response; this is not a confirmed healthy designation."
    },
    injuryCount: injuryEntries.length,
    playerCount: new Set(injuryEntries.map(entry => entry.playerId)).size,
    injuries: injuryEntries
  });

  health.generatedAt = generatedAt;
  health.sources.depthCharts = {
    status: resolvedDepthEntries.length ? "available" : "unavailable",
    provider: "nflverse (ESPN-derived)",
    newestSnapshotAt,
    matchedPlayers: resolvedDepthEntries.length,
    unmatchedPlayers: 0,
    sourceUnmatchedExcluded: unmatched.length
  };
  health.sources.injuries = {
    status: "partial",
    provider: "ESPN roster feeds",
    reportedPlayers: new Set(injuryEntries.map(entry => entry.playerId)).size,
    reason: "Official weekly practice reports are not active during preseason."
  };
  const usageFile = path.join(DATA, "nfl_usage_baselines.json");
  if (fs.existsSync(usageFile)) {
    const usage = read("nfl_usage_baselines.json");
    health.sources.historicalPlayByPlay = {
      status: "available", provider: "nflverse / nflfastR", seasons: usage.seasons,
      regularSeasonPlays: usage.sourcePlayCount
    };
    health.sources.usageBaselines = { status: "available", provider: "The Slip Lab", playerProfiles: usage.profileCount };
    health.sources.routes = { status: "unavailable", provider: null, reason: "Routes are not present in play-by-play and are not inferred." };
    health.status = "historical_usage_ready";
  } else {
    health.status = "availability_foundation_ready";
  }
  write("nfl_data_health.json", health);
}

main().catch(error => {
  console.error("NFL AVAILABILITY FETCH FAILED");
  console.error(error);
  process.exit(1);
});
