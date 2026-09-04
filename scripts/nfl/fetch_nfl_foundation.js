import fs from "fs";
import { isActiveRoster } from "./launch_safety.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "website", "data");
const SEASON = Number(process.env.NFL_SEASON || 2026);
const TARGET_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function easternDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(value));
}

function writeJson(filename, payload) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, filename), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Built website/data/${filename}`);
}

async function fetchJson(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (![403, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
      throw new Error(`NFL fetch failed (${response.status}): ${url}`);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 500));
  }
  throw new Error(`NFL fetch failed after retries: ${url}`);
}

function normalizeTeam(raw = {}) {
  const logo = raw.logos?.find(item => item.rel?.includes("default"))?.href || raw.logos?.[0]?.href || "";
  return {
    teamId: String(raw.id || ""),
    uid: raw.uid || "",
    abbreviation: raw.abbreviation || "",
    location: raw.location || "",
    name: raw.name || "",
    displayName: raw.displayName || "",
    shortDisplayName: raw.shortDisplayName || "",
    slug: raw.slug || "",
    color: raw.color ? `#${raw.color}` : "",
    alternateColor: raw.alternateColor ? `#${raw.alternateColor}` : "",
    logo
  };
}

function gameTeam(competitor = {}) {
  const team = competitor.team || {};
  return {
    teamId: String(team.id || competitor.id || ""),
    abbreviation: team.abbreviation || "",
    displayName: team.displayName || "",
    shortDisplayName: team.shortDisplayName || team.name || "",
    logo: team.logo || "",
    homeAway: competitor.homeAway || ""
  };
}

function normalizeGame(event = {}) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find(item => item.homeAway === "home") || {};
  const away = competitors.find(item => item.homeAway === "away") || {};
  const broadcasts = competition.broadcasts?.flatMap(item => item.names || []).filter(Boolean) || [];
  return {
    gameId: String(event.id || competition.id || ""),
    season: Number(event.season?.year || SEASON),
    seasonType: Number(event.season?.type || 0),
    seasonTypeLabel: event.season?.slug || "",
    week: Number(event.week?.number || 0),
    name: event.name || "",
    shortName: event.shortName || "",
    kickoffUTC: event.date || "",
    dateET: easternDate(event.date),
    status: event.status?.type?.description || "Scheduled",
    state: event.status?.type?.state || "pre",
    completed: Boolean(event.status?.type?.completed),
    venue: competition.venue?.fullName || "",
    city: competition.venue?.address?.city || "",
    stateCode: competition.venue?.address?.state || "",
    indoor: competition.venue?.indoor ?? null,
    broadcasts: [...new Set(broadcasts)],
    neutralSite: Boolean(competition.neutralSite),
    homeTeam: gameTeam(home),
    awayTeam: gameTeam(away)
  };
}

function normalizePlayer(raw = {}, team = {}) {
  const position = raw.position?.abbreviation || "";
  const injuries = Array.isArray(raw.injuries) ? raw.injuries.map(injury => ({
    status: injury.status || injury.type?.description || "",
    type: injury.type?.name || injury.type?.description || "",
    detail: injury.details?.detail || injury.details?.type || "",
    date: injury.date || ""
  })) : [];
  return {
    playerId: String(raw.id || ""),
    uid: raw.uid || "",
    fullName: raw.fullName || raw.displayName || "",
    shortName: raw.shortName || "",
    teamId: team.teamId,
    team: team.abbreviation,
    teamName: team.displayName,
    position,
    jersey: raw.jersey || "",
    status: raw.status?.type || raw.status?.name || "unknown",
    experienceYears: Number(raw.experience?.years || 0),
    headshot: raw.headshot?.href || "",
    injuries,
    marketEligibility: {
      anytimeTd: TARGET_POSITIONS.has(position),
      receivingYards: ["WR", "TE", "RB"].includes(position)
    },
    availability: {
      roster: "available",
      depthChart: "pending",
      injury: injuries.length ? "reported" : "no_report_in_roster_feed",
      usage: "pending",
    }
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const date = process.env.NFL_DATE || todayET();
  const scheduleUrls = [SEASON, SEASON + 1].map(year =>
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${year}&limit=1000`
  );
  const teamsUrl = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40";
  const scheduleRawParts = [];
  for (const url of scheduleUrls) scheduleRawParts.push(await fetchJson(url));
  const teamsRaw = await fetchJson(teamsUrl);

  const teamRows = teamsRaw.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamRows.map(row => normalizeTeam(row.team)).sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  if (teams.length !== 32) throw new Error(`Expected 32 NFL teams, received ${teams.length}`);

  const allGames = scheduleRawParts.flatMap(raw => raw.events || []).map(normalizeGame);
  const games = allGames
    .filter(game => game.season === SEASON && game.seasonType === 2)
    .sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
  if (games.length < 272) throw new Error(`Expected at least 272 regular-season games, received ${games.length}`);

  const cachedPoolPath = path.join(DATA_DIR, "nfl_player_pool.json");
  const cachedPool = fs.existsSync(cachedPoolPath) ? JSON.parse(fs.readFileSync(cachedPoolPath, "utf8")) : { players: [] };
  const cachedByTeam = new Map(teams.map(team => [team.teamId, (cachedPool.players || []).filter(player => player.teamId === team.teamId)]));
  const rosterWarnings = [];
  const rosterResults = [];
  for (let index = 0; index < teams.length; index += 4) {
    const batch = teams.slice(index, index + 4);
    const results = await Promise.all(batch.map(async team => {
      const identifiers = [team.teamId, team.abbreviation.toLowerCase(), team.slug].filter(Boolean);
      let lastError;
      for (const identifier of [...new Set(identifiers)]) {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${identifier}/roster`;
        try {
          const raw = await fetchJson(url);
          const athletes = (raw.athletes || []).flatMap(group => group.items || []);
          if (athletes.length) return athletes.map(player => normalizePlayer(player, team));
        } catch (error) { lastError = error; }
      }
      const cached = cachedByTeam.get(team.teamId) || [];
      if (!cached.length) throw lastError || new Error(`No roster available for ${team.abbreviation}`);
      rosterWarnings.push({ team: team.abbreviation, status: "cached_fallback", playerCount: cached.length, reason: lastError?.message || "empty live roster" });
      return cached;
    }));
    rosterResults.push(...results);
  }
  const excludedPlayers = rosterResults.flat().filter(player => TARGET_POSITIONS.has(player.position) && !isActiveRoster(player));
  const players = rosterResults.flat()
    .filter(player => TARGET_POSITIONS.has(player.position) && isActiveRoster(player))
    .sort((a, b) => a.team.localeCompare(b.team) || a.position.localeCompare(b.position) || a.fullName.localeCompare(b.fullName));
  const duplicateIds = players.filter((player, index) => players.findIndex(other => other.playerId === player.playerId) !== index);
  if (duplicateIds.length) throw new Error(`Duplicate player IDs found: ${duplicateIds.slice(0, 5).map(p => p.playerId).join(", ")}`);

  const currentDateGames = allGames.filter(game => game.dateET === date);
  const weekOne = games.filter(game => game.week === 1);
  const nextKickoff = games.find(game => Date.parse(game.kickoffUTC) >= Date.now()) || games[0];
  const generatedAt = new Date().toISOString();
  const common = { sport: "NFL", schemaVersion: "1.0", season: SEASON, generatedAt };

  writeJson("nfl_teams.json", {
    ...common, source: "ESPN NFL teams feed", sourceUrl: teamsUrl, teamCount: teams.length, teams
  });
  writeJson("nfl_schedule.json", {
    ...common, source: "ESPN NFL scoreboard feed", sourceUrls: scheduleUrls,
    seasonType: "regular-season", gameCount: games.length, weekCount: Math.max(...games.map(game => game.week)), games
  });
  writeJson("nfl_games_today.json", {
    ...common, source: "ESPN NFL scoreboard feed", sourceUrls: scheduleUrls, date,
    gameCount: currentDateGames.length,
    availability: currentDateGames.length ? "games_scheduled" : "no_games_scheduled",
    games: currentDateGames
  });
  writeJson("nfl_player_pool.json", {
    ...common, source: "ESPN NFL roster feeds", eligibility: ["QB", "RB", "WR", "TE"],
    playerCount: players.length, teamCount: new Set(players.map(player => player.teamId)).size,
    excludedRosterCount: excludedPlayers.length,
    excludedPlayers: excludedPlayers.map(({playerId, fullName, team, position, status}) => ({playerId, fullName, team, position, status, reason: "not_active_roster"})),
    availability: players.length ? "rosters_available_roles_pending" : "unavailable", warnings: rosterWarnings, players
  });
  writeJson("nfl_data_health.json", {
    ...common, status: "foundation_ready", startedAt,
    counts: { teams: teams.length, regularSeasonGames: games.length, weekOneGames: weekOne.length, eligiblePlayers: players.length },
    nextKickoff: nextKickoff ? { gameId: nextKickoff.gameId, kickoffUTC: nextKickoff.kickoffUTC, matchup: nextKickoff.shortName } : null,
    sources: {
      schedule: { status: "available", provider: "ESPN" },
      teams: { status: "available", provider: "ESPN" },
      rosters: { status: rosterWarnings.length ? "available_with_cached_team_fallback" : "available", provider: "ESPN", warnings: rosterWarnings },
      depthCharts: { status: "pending", provider: null },
      injuries: { status: "partial", provider: "ESPN roster feed" },
      historicalPlayByPlay: { status: "pending", provider: null },
      projections: { status: "disabled", reason: "Usage, depth-chart, and market inputs are not validated." }
    }
  });
}

main().catch(error => {
  console.error("NFL FOUNDATION FETCH FAILED");
  console.error(error);
  process.exit(1);
});
