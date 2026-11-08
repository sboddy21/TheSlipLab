import fs from "fs";
import { depthMatchesPlayer } from "./launch_safety.js";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "website", "data");
const SEASON = Number(process.env.NFL_SEASON || 2026);
const DEPTH_URL = `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${SEASON}.csv`;
const INJURY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";
const TARGET_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

function read(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA, filename), "utf8"));
}

function readOptional(filename) {
  try { return read(filename); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
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

export async function fetchText(url, attempts = 5, fetcher = fetch, wait = delay => new Promise(resolve => setTimeout(resolve, delay))) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
      if (response.ok) return response.text();
      lastError = new Error(`NFL availability fetch failed (${response.status}): ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await wait(Math.min(16000, 1000 * 2 ** (attempt - 1)));
  }
  throw lastError || new Error(`NFL availability fetch failed after retries: ${url}`);
}

async function fetchJson(url, attempts = 5) {
  return JSON.parse(await fetchText(url, attempts));
}

function usableCachedDepth(payload, playersById) {
  const entries = (payload?.entries || []).filter(entry => depthMatchesPlayer(entry, playersById.get(String(entry.playerId))));
  return entries.length && new Set(entries.map(entry => entry.team)).size === 32 ? { ...payload, entries } : null;
}

function usableCachedInjuries(payload) {
  return payload && ["available", "partial"].includes(payload.availability) && Array.isArray(payload.injuries) ? payload : null;
}

export async function main() {
  const generatedAt = new Date().toISOString();
  const pool = read("nfl_player_pool.json");
  const health = read("nfl_data_health.json");
  const playersById = new Map(pool.players.map(player => [String(player.playerId), player]));
  let csv = null;
  let leagueInjuries = null;
  let depthError = null;
  let injuryError = null;
  try { csv = await fetchText(DEPTH_URL); } catch (error) { depthError = error; }
  try { leagueInjuries = await fetchJson(INJURY_URL); } catch (error) { injuryError = error; }
  const cachedDepth = depthError ? usableCachedDepth(readOptional("nfl_depth_charts.json"), playersById) : null;
  const cachedInjuries = injuryError ? usableCachedInjuries(readOptional("nfl_injuries.json")) : null;
  if (depthError && !cachedDepth) throw depthError;
  if (injuryError && !cachedInjuries) throw injuryError;
  if (depthError) console.warn(`NFL depth charts delayed; preserving last verified snapshot: ${depthError.message}`);
  if (injuryError) console.warn(`NFL injuries delayed; preserving last verified snapshot: ${injuryError.message}`);
  if (cachedDepth && cachedInjuries) {
    health.generatedAt = generatedAt;
    health.sources.depthCharts = { ...health.sources.depthCharts, status: "available_cached", delayed: true, reason: depthError.message };
    health.sources.injuries = { ...health.sources.injuries, status: "available_cached", delayed: true, reason: injuryError.message };
    write("nfl_data_health.json", health);
    return;
  }
  if (cachedDepth) csv = null;
  if (cachedInjuries) leagueInjuries = null;
  const cachedDepthEntries = cachedDepth?.entries || [];
  const cachedInjuryEntries = cachedInjuries?.injuries || [];
  const cachedLeagueTimestamp = cachedInjuries?.leagueTimestamp || cachedInjuries?.generatedAt || generatedAt;
  const cachedCurrentLeagueFeed = Boolean(cachedInjuries?.currentLeagueFeed);
  const cachedDepthSnapshots = cachedDepthEntries.map(entry => entry.snapshotAt).filter(Boolean);
  const cachedDepthNewest = cachedDepth?.newestSnapshotAt || cachedDepthSnapshots.sort().at(-1) || null;
  const cachedDepthOldest = cachedDepth?.oldestSnapshotAt || cachedDepthSnapshots.sort().at(0) || null;
  const csvText = csv || "";
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  const headers = lines.length ? parseCsvLine(lines.shift()) : [];
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

  const rosterEntries = pool.players.flatMap(player => (player.injuries || []).map(injury => ({
    playerId: player.playerId,
    playerName: player.fullName,
    team: player.team,
    position: player.position,
    status: injury.status || "reported",
    type: injury.type || "",
    detail: injury.detail || "",
    reportedAt: injury.date || "",
    sourceCoverage: "team_roster_feed"
  })));
  const currentLeagueEntries = (leagueInjuries?.injuries || []).map(item => {
    const athlete = item.athlete || {};
    const player = playersById.get(String(athlete.id || ""));
    if (!player) return null;
    return {
      playerId: player.playerId,
      playerName: player.fullName,
      team: player.team,
      position: player.position,
      status: item.status || "reported",
      type: item.type?.description || item.type?.name || "",
      detail: item.details?.detail || item.details?.type || "",
      reportedAt: item.date || leagueInjuries?.timestamp || "",
      sourceCoverage: "current_league_injury_designation"
    };
  }).filter(Boolean);
  const injuryByPlayer = new Map((cachedInjuries ? cachedInjuryEntries : rosterEntries).map(entry => [String(entry.playerId), entry]));
  for (const entry of currentLeagueEntries) injuryByPlayer.set(String(entry.playerId), entry);
  const injuryEntries = [...injuryByPlayer.values()].sort((a, b) => a.team.localeCompare(b.team) || a.playerName.localeCompare(b.playerName));
  const leagueTimestamp = leagueInjuries?.timestamp || cachedLeagueTimestamp;
  const leagueAgeHours = (Date.now() - Date.parse(leagueTimestamp)) / 36e5;
  const currentLeagueFeed = leagueInjuries ? Number.isFinite(leagueAgeHours) && leagueAgeHours >= 0 && leagueAgeHours <= 24 : cachedCurrentLeagueFeed;

  const unmatched = depthEntries.filter(entry => !entry.canonicalPlayerMatch);
  const resolvedDepthEntries = cachedDepth ? cachedDepthEntries : depthEntries.filter(entry => entry.canonicalPlayerMatch);
  const snapshots = [...latestByTeam.values()].map(Date.parse).filter(Number.isFinite);
  const newestSnapshotAt = cachedDepth ? cachedDepthNewest : snapshots.length ? new Date(Math.max(...snapshots)).toISOString() : null;
  const oldestSnapshotAt = cachedDepth ? cachedDepthOldest : snapshots.length ? new Date(Math.min(...snapshots)).toISOString() : null;

  if (!cachedDepth) write("nfl_depth_charts.json", {
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

  if (!cachedInjuries) write("nfl_injuries.json", {
    sport: "NFL", schemaVersion: "1.0", season: SEASON, generatedAt,
    source: "ESPN NFL league injury designations with team-roster fallback",
    sourceUrl: INJURY_URL,
    availability: currentLeagueFeed ? "available" : "partial",
    coverage: "Current league injury designations. Practice participation is not inferred when the provider does not supply it.",
    leagueTimestamp,
    currentLeagueFeed,
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
    status: cachedDepth ? "available_cached" : resolvedDepthEntries.length ? "available" : "unavailable",
    provider: "nflverse (ESPN-derived)",
    newestSnapshotAt,
    matchedPlayers: resolvedDepthEntries.length,
    unmatchedPlayers: 0,
    sourceUnmatchedExcluded: unmatched.length,
    delayed: Boolean(cachedDepth),
    ...(depthError ? { reason: depthError.message } : {})
  };
  health.sources.injuries = {
    status: cachedInjuries ? "available_cached" : currentLeagueFeed ? "available" : "partial",
    provider: "ESPN league injury designations",
    reportedPlayers: new Set(injuryEntries.map(entry => entry.playerId)).size,
    currentLeagueFeed,
    leagueTimestamp,
    delayed: Boolean(cachedInjuries),
    reason: injuryError?.message || (currentLeagueFeed ? "Current player designations available; practice participation remains separate." : "Current league injury feed is stale or unavailable.")
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("NFL AVAILABILITY FETCH FAILED");
    console.error(error);
    process.exit(1);
  });
}
