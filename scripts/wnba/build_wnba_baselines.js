import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const PLAYER_OUT = path.join(ROOT, "website/data/wnba_player_baselines.json");
const TEAM_OUT = path.join(ROOT, "website/data/wnba_team_baselines.json");
const SEASON = Number(process.env.WNBA_SEASON || new Date().getUTCFullYear());

const TEAM_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams";
const rosterUrl = slug => `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${slug}/roster`;
const teamStatsUrl = slug => `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${slug}/statistics?season=${SEASON}`;
const teamDetailUrl = slug => `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${slug}?season=${SEASON}`;
const statsUrl = id => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${id}/stats?region=us&lang=en&season=${SEASON}`;
const gameLogUrl = id => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${id}/gamelog?region=us&lang=en&season=${SEASON}`;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "Accept": "application/json,text/plain,*/*", "User-Agent": "TheSlipLab/1.0 (+https://www.thesliplab.com/)" }
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const number = value => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function splitMadeAttempted(value) {
  const [made, attempted] = String(value || "0-0").split("-").map(number);
  return { made, attempted };
}

function currentAverage(stats, teamId) {
  const category = stats?.categories?.find(item => item.name === "averages");
  if (!category) return null;
  const row = category.statistics?.find(item => Number(item.season?.year) === SEASON && String(item.teamId) === String(teamId))
    || category.statistics?.find(item => Number(item.season?.year) === SEASON);
  if (!row) return null;
  const mapped = Object.fromEntries(category.names.map((name, index) => [name, row.stats?.[index] ?? ""]));
  const fieldGoals = splitMadeAttempted(mapped["avgFieldGoalsMade-avgFieldGoalsAttempted"]);
  const threes = splitMadeAttempted(mapped["avgThreePointFieldGoalsMade-avgThreePointFieldGoalsAttempted"]);
  return {
    games: number(mapped.gamesPlayed), starts: number(mapped.gamesStarted), minutes: number(mapped.avgMinutes),
    points: number(mapped.avgPoints), rebounds: number(mapped.avgRebounds), assists: number(mapped.avgAssists),
    steals: number(mapped.avgSteals), blocks: number(mapped.avgBlocks), turnovers: number(mapped.avgTurnovers),
    fieldGoalsMade: fieldGoals.made, fieldGoalsAttempted: fieldGoals.attempted, fieldGoalPct: number(mapped.fieldGoalPct),
    threesMade: threes.made, threesAttempted: threes.attempted, threePointPct: number(mapped.threePointFieldGoalPct),
    freeThrowPct: number(mapped.freeThrowPct)
  };
}

function recentAverage(gameLog, count = 5) {
  const regular = gameLog?.seasonTypes?.find(item => String(item.displayName || "").includes("Regular Season"));
  const rows = regular?.categories?.flatMap(category => category.events || []) || [];
  const names = Array.isArray(gameLog?.names) ? gameLog.names : [];
  const recent = rows.slice(0, count).map(row => Object.fromEntries(names.map((name, index) => [name, row.stats?.[index] ?? ""])));
  if (!recent.length) return null;
  const average = key => Number((recent.reduce((sum, row) => sum + number(row[key]), 0) / recent.length).toFixed(1));
  return {
    games: recent.length, minutes: average("minutes"), points: average("points"), rebounds: average("totalRebounds"),
    assists: average("assists"), steals: average("steals"), blocks: average("blocks"), turnovers: average("turnovers")
  };
}

function normalizeInjury(injury) {
  if (!injury) return null;
  return {
    status: injury.status || injury.type?.description || injury.type?.name || "Reported",
    type: injury.type?.description || injury.type?.name || "",
    detail: injury.details?.detail || injury.shortComment || injury.longComment || "",
    date: injury.date || injury.details?.returnDate || ""
  };
}

function roleBand(minutes) {
  if (minutes >= 30) return "Core";
  if (minutes >= 24) return "Starter";
  if (minutes >= 16) return "Rotation";
  return "Depth";
}

function roleScore(season, recent) {
  const minutes = recent?.minutes || season.minutes;
  const production = season.points + season.assists * 1.35 + season.rebounds * .7;
  return Math.max(0, Math.min(100, Math.round(minutes * 1.8 + production * .9)));
}

function teamEnvironment(statsResponse, detailResponse) {
  const categories = statsResponse?.results?.stats?.categories || [];
  const statRows = categories.flatMap(category => category.stats || []);
  const stat = name => number(statRows.find(row => row.name === name)?.value);
  const record = detailResponse?.team?.record?.items?.find(item => item.type === "total");
  const recordStat = name => number(record?.stats?.find(row => row.name === name)?.value);
  const possessions = stat("avgFieldGoalsAttempted") - stat("avgOffensiveRebounds") + stat("avgTurnovers") + .44 * stat("avgFreeThrowsAttempted");
  const pointsFor = stat("avgPoints") || recordStat("avgPointsFor");
  const pointsAgainst = recordStat("avgPointsAgainst");
  return {
    record: record?.summary || "",
    games: stat("gamesPlayed") || recordStat("gamesPlayed"),
    pointsFor: Number(pointsFor.toFixed(1)), pointsAgainst: Number(pointsAgainst.toFixed(1)),
    pointDifferential: Number((pointsFor - pointsAgainst).toFixed(1)),
    estimatedPace: Number(possessions.toFixed(1)),
    estimatedOffensiveRating: possessions ? Number((pointsFor / possessions * 100).toFixed(1)) : 0,
    rebounds: Number(stat("avgRebounds").toFixed(1)), assists: Number(stat("avgAssists").toFixed(1)),
    turnovers: Number(stat("avgTurnovers").toFixed(1)), fieldGoalPct: Number(stat("fieldGoalPct").toFixed(1)),
    threePointPct: Number(stat("threePointPct").toFixed(1))
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const teamResponse = await fetchJson(TEAM_URL);
  const teams = teamResponse?.sports?.[0]?.leagues?.[0]?.teams?.map(item => item.team).filter(Boolean) || [];
  if (!teams.length) throw new Error("WNBA team directory returned no teams");

  const rosters = await mapLimit(teams, 5, async team => {
    const slug = team.abbreviation?.toLowerCase();
    const roster = await fetchJson(rosterUrl(slug));
    return { team, athletes: roster.athletes || [] };
  });

  const teamEnvironmentRows = await mapLimit(teams, 5, async team => {
    const slug = team.abbreviation?.toLowerCase();
    const [stats, detail] = await Promise.all([fetchJson(teamStatsUrl(slug)), fetchJson(teamDetailUrl(slug))]);
    return [String(team.id), teamEnvironment(stats, detail)];
  });
  const environmentByTeam = new Map(teamEnvironmentRows);

  const rawPlayers = rosters.flatMap(({ team, athletes }) => athletes.map(athlete => ({ team, athlete })));
  const statFailures = [];
  const playersWithStats = await mapLimit(rawPlayers, 8, async item => {
    try {
      const stats = await fetchJson(statsUrl(item.athlete.id));
      return { ...item, season: currentAverage(stats, item.team.id) };
    } catch (error) {
      statFailures.push(`${item.athlete.displayName}: ${error.message}`);
      return { ...item, season: null };
    }
  });

  const rotationPlayers = playersWithStats.filter(item => item.season?.minutes >= 10);
  const logFailures = [];
  const recentById = new Map();
  await mapLimit(rotationPlayers, 6, async item => {
    try {
      recentById.set(String(item.athlete.id), recentAverage(await fetchJson(gameLogUrl(item.athlete.id))));
    } catch (error) {
      logFailures.push(`${item.athlete.displayName}: ${error.message}`);
    }
  });

  const players = playersWithStats.filter(item => item.season).map(({ team, athlete, season }) => {
    const recent = recentById.get(String(athlete.id)) || null;
    const injury = normalizeInjury(athlete.injuries?.[0]);
    return {
      playerId: String(athlete.id), player: athlete.displayName || athlete.fullName || "", slug: athlete.slug || "",
      teamId: String(team.id), team: team.displayName || "", teamAbbreviation: team.abbreviation || "",
      jersey: athlete.jersey || "", position: athlete.position?.abbreviation || "", headshot: athlete.headshot?.href || "",
      active: athlete.status?.type !== "inactive", injury, season, recent,
      role: roleBand(recent?.minutes || season.minutes), roleScore: roleScore(season, recent)
    };
  }).sort((a, b) => b.roleScore - a.roleScore || b.season.minutes - a.season.minutes || a.player.localeCompare(b.player));

  const teamBaselines = teams.map(team => {
    const teamPlayers = players.filter(player => player.teamId === String(team.id));
    const rotation = teamPlayers.filter(player => player.season.minutes >= 10);
    const environment = environmentByTeam.get(String(team.id)) || {};
    return {
      teamId: String(team.id), team: team.displayName || "", abbreviation: team.abbreviation || "",
      logo: team.logos?.[0]?.href || "", color: team.color ? `#${team.color}` : "",
      rosterCount: rawPlayers.filter(item => String(item.team.id) === String(team.id)).length,
      rotationCount: rotation.length, injuryCount: teamPlayers.filter(player => player.injury).length,
      environment,
      corePlayers: rotation.slice(0, 5).map(player => ({ playerId: player.playerId, player: player.player, role: player.role, roleScore: player.roleScore, minutes: player.season.minutes })),
      availableMinutesSample: Number(rotation.reduce((sum, player) => sum + player.season.minutes, 0).toFixed(1))
    };
  });
  const ranked = (key, ascending = false) => [...teamBaselines].sort((a, b) => ascending ? number(a.environment[key]) - number(b.environment[key]) : number(b.environment[key]) - number(a.environment[key]));
  for (const team of teamBaselines) {
    team.environment.paceRank = ranked("estimatedPace").findIndex(row => row.teamId === team.teamId) + 1;
    team.environment.offenseRank = ranked("pointsFor").findIndex(row => row.teamId === team.teamId) + 1;
    team.environment.defenseRank = ranked("pointsAgainst", true).findIndex(row => row.teamId === team.teamId) + 1;
  }
  teamBaselines.sort((a, b) => a.team.localeCompare(b.team));

  const common = { sport: "WNBA", season: SEASON, phase: "independent_baselines", source: "ESPN WNBA rosters, season statistics, and player game logs", generatedAt: new Date().toISOString() };
  const playerOutput = { ...common, playerCount: players.length, rotationHistoryCount: players.filter(player => player.recent).length, warnings: [...statFailures, ...logFailures], players };
  const teamOutput = { ...common, teamCount: teamBaselines.length, teams: teamBaselines };
  fs.writeFileSync(PLAYER_OUT, `${JSON.stringify(playerOutput, null, 2)}\n`);
  fs.writeFileSync(TEAM_OUT, `${JSON.stringify(teamOutput, null, 2)}\n`);
  console.log(`WNBA BASELINES COMPLETE: ${teamBaselines.length} teams, ${players.length} players, ${playerOutput.rotationHistoryCount} recent histories`);
  console.log(`Started: ${startedAt}`);
}

main().catch(error => {
  console.error("WNBA BASELINES FAILED");
  console.error(error);
  process.exit(1);
});
