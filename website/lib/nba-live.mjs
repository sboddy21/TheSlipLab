const API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
export const easternDate = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
const observed = now => new Date(now).toISOString();
const number = value => value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
const nameKey = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cache = new Map();

async function json(url, fetcher) {
  const response = await fetcher(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`NBA provider returned HTTP ${response.status}`);
  return response.json();
}

export function normalizeNbaSchedule(payload, date) {
  if (!payload?.leagues?.some(league => league.slug === "nba") || !Array.isArray(payload.events)) throw new Error("NBA schedule response is incomplete");
  return payload.events.map(event => {
    const competition = event.competitions?.[0];
    const normalizeTeam = side => {
      const row = competition?.competitors?.find(team => team.homeAway === side);
      if (!row?.team?.id || !row.team.abbreviation) throw new Error("NBA team identity is incomplete");
      return { id: String(row.team.id), name: row.team.displayName, shortName: row.team.shortDisplayName || row.team.name, abbreviation: row.team.abbreviation, logo: row.team.logo || "", score: number(row.score), record: row.records?.find(item => item.type === "total")?.summary || "", leaders: row.leaders || [] };
    };
    if (!event.id || !Number.isFinite(Date.parse(event.date)) || easternDate(Date.parse(event.date)) !== date) throw new Error("NBA provider returned a different slate date");
    const status = competition?.status || event.status || {};
    return { id: String(event.id), idProvider: "ESPN", date: event.date, state: status.type?.state || "pre", status: status.type?.shortDetail || status.type?.detail || "Scheduled", period: status.period || 0, clock: status.displayClock || "", venue: competition?.venue?.fullName || "Venue pending", home: normalizeTeam("home"), away: normalizeTeam("away") };
  });
}

function parseInjuries(payload, now) {
  const time = Date.parse(payload?.timestamp);
  if (!Array.isArray(payload?.injuries) || !Number.isFinite(time) || now - time > 3600000 || time > now + 60000) throw new Error("Current injury feed could not be verified");
  return payload.injuries.flatMap(team => (team.injuries || []).map(row => ({ playerId: String(row.athlete?.id || ""), player: row.athlete?.displayName || "", team: team.displayName || "", status: row.status || "Reported", detail: row.shortComment || row.longComment || "", reportedAt: row.date || "" }))).filter(row => row.player);
}

export async function buildNbaWorkspace({ fetcher = fetch, now = Date.now() } = {}) {
  const date = easternDate(now);
  const scheduleUrl = `${API}/scoreboard?dates=${date.replaceAll("-", "")}&limit=100`;
  const [schedule, injuryResponse] = await Promise.allSettled([json(scheduleUrl, fetcher), json(`${API}/injuries`, fetcher)]);
  if (schedule.status !== "fulfilled") throw schedule.reason;
  const games = normalizeNbaSchedule(schedule.value, date);
  const warnings = [];
  let injuries = [], injuryStatus = "current";
  try {
    if (injuryResponse.status !== "fulfilled") throw injuryResponse.reason;
    injuries = parseInjuries(injuryResponse.value, now);
  } catch { injuryStatus = "unavailable"; warnings.push("The injury feed is unavailable. Missing reports do not confirm availability."); }
  const teams = [...new Map(games.flatMap(game => [game.away, game.home]).map(team => [team.id, team])).values()];
  const rosters = await Promise.allSettled(teams.map(team => json(`${API}/teams/${team.id}/roster`, fetcher)));
  const players = [];
  let rosterFailures = 0;
  const year = Number(schedule.value.leagues[0]?.season?.year);
  teams.forEach((team, index) => {
    const response = rosters[index];
    const rosterTime = response.status === "fulfilled" ? Date.parse(response.value.timestamp) : NaN;
    if (response.status !== "fulfilled" || !Array.isArray(response.value.athletes) || Number(response.value.team?.id) !== Number(team.id) || Number(response.value.season?.year) !== year || !Number.isFinite(rosterTime) || now - rosterTime > 3600000 || rosterTime > now + 60000) { rosterFailures++; return; }
    const game = games.find(row => row.home.id === team.id || row.away.id === team.id);
    for (const athlete of response.value.athletes) {
      if (!athlete.id || !athlete.displayName) continue;
      const injury = injuries.find(row => row.playerId ? row.playerId === String(athlete.id) : nameKey(row.player) === nameKey(athlete.displayName)) || null;
      const leaderStats = {};
      for (const category of team.leaders) {
        const row = category.leaders?.find(leader => String(leader.athlete?.id) === String(athlete.id) && String(leader.athlete?.team?.id || leader.team?.id) === team.id);
        if (row) leaderStats[category.name] = number(row.value);
      }
      players.push({ id: String(athlete.id), idProvider: "ESPN", player: athlete.displayName, position: athlete.position?.abbreviation || "", team: team.abbreviation, teamName: team.name, teamId: team.id, gameId: game.id, opponent: game.home.id === team.id ? game.away.abbreviation : game.home.abbreviation, headshot: athlete.headshot?.href || "", injury, availability: injury?.status || "Unconfirmed", leaderStats });
    }
  });
  if (rosterFailures) warnings.push(`${rosterFailures} team roster${rosterFailures === 1 ? " is" : "s are"} temporarily unavailable.`);
  return { sport: "NBA", date, season: schedule.value.leagues[0]?.season?.displayName || "", seasonYear: year, fetchedAt: observed(now), source: "ESPN date-specific NBA scoreboard, current-season team rosters and league injury reports", sourceUrl: scheduleUrl, refreshAfterSeconds: 60, games, players, injuries: injuries.filter(row => teams.some(team => team.name === row.team)), panels: { schedule: "current", rosters: rosterFailures ? "partial" : "current", injuries: injuryStatus }, warnings };
}

export function parseNbaPlayerLog(payload, year, now = Date.now()) {
  if (!payload?.filters?.some(filter => filter.name === "season" && Number(filter.value) === year) || !Array.isArray(payload.names) || !Array.isArray(payload.seasonTypes)) throw new Error("Player logs do not match the current season");
  const regular = payload.seasonTypes.find(season => /regular season/i.test(season.displayName || ""));
  const games = (regular?.categories || []).flatMap(category => category.events || []).map(row => {
    const stats = Object.fromEntries(payload.names.map((key, i) => [key, row.stats?.[i]]));
    const event = payload.events?.[row.eventId];
    if (!event?.gameDate || Date.parse(event.gameDate) >= now || number(stats.points) === null || number(stats.minutes) === null) return null;
    const made = key => number(String(stats[key] || "").split("-")[0]);
    return { eventId: String(row.eventId), date: event.gameDate, opponent: event.opponent?.abbreviation || "", minutes: number(stats.minutes), points: number(stats.points), rebounds: number(stats.totalRebounds), assists: number(stats.assists), threes: made("threePointFieldGoalsMade-threePointFieldGoalsAttempted") };
  }).filter(Boolean).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const summarize = rows => rows.length ? Object.fromEntries(["points", "rebounds", "assists", "threes", "minutes"].map(key => { const values = rows.map(row => row[key]).filter(value => value !== null); return [key, values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null]; }).concat([["games", rows.length]])) : null;
  return { seasonYear: year, fetchedAt: observed(now), gamesPlayed: games.length, season: summarize(games), last5: summarize(games.slice(0, 5)), last10: summarize(games.slice(0, 10)), recentGames: games.slice(0, 10), source: "ESPN current-season regular-season game logs" };
}

export async function loadNbaLiveFile(file, { fetcher = fetch, now = Date.now() } = {}) {
  const date = easternDate(now);
  const key = `${date}:${file}`;
  const existing = cache.get(key);
  if (existing && now - existing.at < 60000 && now >= existing.at) return existing.promise;
  const promise = file === "nba_workspace.json" ? buildNbaWorkspace({ fetcher, now }) : (async () => {
    const playerId = file.match(/^nba_player_(\d{1,12})\.json$/)?.[1];
    if (!playerId) throw new Error("Invalid NBA live dataset");
    const year = Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) >= 10 ? 1 : 0);
    return parseNbaPlayerLog(await json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?region=us&lang=en&season=${year}`, fetcher), year, now);
  })();
  if (cache.size >= 1000) cache.clear();
  cache.set(key, { at: now, promise });
  try { return await promise; } catch (error) { cache.delete(key); throw error; }
}
