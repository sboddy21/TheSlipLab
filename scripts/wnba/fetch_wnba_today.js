import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "website/data/wnba_games_today.json");

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

const compactDate = value => String(value || "").replaceAll("-", "");
const statValue = (team, name) => team?.statistics?.find(stat => stat.name === name)?.displayValue || "";
const REQUEST_HEADERS = {
  "Accept": "application/json,text/plain,*/*",
  "User-Agent": "TheSlipLab/1.0 (+https://www.thesliplab.com/)"
};

async function fetchJson(url, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(String(url).replace(/^http:/, "https:"), { headers: REQUEST_HEADERS });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) throw new Error(`unexpected content type ${contentType || "unknown"}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error(`${lastError?.message || "request failed"} for ${url}`);
}

async function optionalJson(reference, fallback = null) {
  const url = reference?.$ref || reference;
  if (!url) return fallback;
  try { return await fetchJson(url); } catch { return fallback; }
}

function leader(team, name) {
  const row = team?.leaders?.find(item => item.name === name)?.leaders?.[0];
  return row ? {
    playerId: String(row.athlete?.id || ""),
    player: row.athlete?.displayName || row.athlete?.fullName || "",
    position: row.athlete?.position?.abbreviation || "",
    value: row.displayValue || "",
    headshot: row.athlete?.headshot || ""
  } : null;
}

function normalizeTeam(competitor = {}) {
  const team = competitor.team || {};
  const overall = competitor.records?.find(record => record.name === "overall" || record.type === "total");
  return {
    teamId: String(team.id || competitor.id || ""),
    name: team.displayName || [team.location, team.name].filter(Boolean).join(" "),
    shortName: team.shortDisplayName || team.name || "",
    abbreviation: team.abbreviation || "",
    logo: team.logo || "",
    color: team.color ? `#${team.color}` : "",
    alternateColor: team.alternateColor ? `#${team.alternateColor}` : "",
    score: Number(competitor.score || 0),
    record: overall?.summary || "",
    homeAway: competitor.homeAway || "",
    averages: {
      points: statValue(competitor, "avgPoints"),
      rebounds: statValue(competitor, "avgRebounds"),
      assists: statValue(competitor, "avgAssists")
    },
    leaders: {
      points: leader(competitor, "pointsPerGame"),
      rebounds: leader(competitor, "reboundsPerGame"),
      assists: leader(competitor, "assistsPerGame")
    }
  };
}

function normalizeGame(event = {}) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find(team => team.homeAway === "home") || competitors[0] || {};
  const away = competitors.find(team => team.homeAway === "away") || competitors[1] || {};
  const status = event.status?.type || {};
  const broadcasts = competition.broadcasts?.flatMap(item => item.names || []).filter(Boolean) || [];
  return {
    gameId: String(event.id || competition.id || ""),
    name: event.shortName || event.name || "",
    gameTimeUTC: event.date || "",
    state: status.state || "pre",
    status: status.description || "Scheduled",
    statusDetail: status.shortDetail || status.detail || "",
    completed: Boolean(status.completed),
    period: Number(event.status?.period || 0),
    clock: event.status?.displayClock || "",
    venue: competition.venue?.fullName || "",
    city: competition.venue?.address?.city || "",
    stateCode: competition.venue?.address?.state || "",
    indoor: competition.venue?.indoor ?? null,
    broadcasts: [...new Set(broadcasts)],
    homeTeam: normalizeTeam(home),
    awayTeam: normalizeTeam(away)
  };
}

function coreRecord(record) {
  const item = record?.items?.find(row => row.type === "total") || record?.items?.[0];
  if (item?.summary) return item.summary;
  const wins = item?.stats?.find(stat => stat.name === "wins")?.value;
  const losses = item?.stats?.find(stat => stat.name === "losses")?.value;
  return Number.isFinite(Number(wins)) && Number.isFinite(Number(losses)) ? `${wins}-${losses}` : "";
}

async function normalizeCoreTeam(competitor = {}) {
  const [team, score, record] = await Promise.all([
    optionalJson(competitor.team, {}), optionalJson(competitor.score, {}), optionalJson(competitor.record, {})
  ]);
  return {
    teamId: String(team.id || competitor.id || ""),
    name: team.displayName || team.name || "",
    shortName: team.shortDisplayName || team.name || "",
    abbreviation: team.abbreviation || "",
    logo: team.logos?.[0]?.href || "",
    color: team.color ? `#${team.color}` : "",
    alternateColor: team.alternateColor ? `#${team.alternateColor}` : "",
    score: Number(score.value ?? score.displayValue ?? 0),
    record: coreRecord(record),
    homeAway: competitor.homeAway || "",
    averages: { points: "", rebounds: "", assists: "" },
    leaders: { points: null, rebounds: null, assists: null }
  };
}

async function normalizeCoreGame(event = {}) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find(team => team.homeAway === "home") || competitors[0] || {};
  const away = competitors.find(team => team.homeAway === "away") || competitors[1] || {};
  const [status, broadcasts, homeTeam, awayTeam] = await Promise.all([
    optionalJson(competition.status, {}), optionalJson(competition.broadcasts, {}),
    normalizeCoreTeam(home), normalizeCoreTeam(away)
  ]);
  const statusType = status.type || {};
  const broadcastItems = broadcasts.items || [];
  return {
    gameId: String(event.id || competition.id || ""), name: event.shortName || event.name || "",
    gameTimeUTC: event.date || competition.date || "", state: statusType.state || "pre",
    status: statusType.description || "Scheduled", statusDetail: statusType.shortDetail || statusType.detail || "",
    completed: Boolean(statusType.completed), period: Number(status.period || 0), clock: status.displayClock || "",
    venue: competition.venue?.fullName || "", city: competition.venue?.address?.city || "",
    stateCode: competition.venue?.address?.state || "", indoor: competition.venue?.indoor ?? null,
    broadcasts: [...new Set(broadcastItems.flatMap(item => item.names || [item.name]).filter(Boolean))],
    homeTeam, awayTeam
  };
}

async function fetchCoreGames(date) {
  const indexUrl = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/events?dates=${compactDate(date)}&limit=100`;
  const index = await fetchJson(indexUrl);
  const events = await Promise.all((index.items || []).map(item => fetchJson(item.$ref)));
  return { games: await Promise.all(events.map(normalizeCoreGame)), url: indexUrl };
}

async function main() {
  const date = process.env.WNBA_DATE || todayET();
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${compactDate(date)}`;
  let games;
  let sourceUrl = url;
  let source = "ESPN WNBA scoreboard feed";
  const warnings = [];
  try {
    const raw = await fetchJson(url);
    games = Array.isArray(raw.events) ? raw.events.map(normalizeGame) : [];
  } catch (error) {
    warnings.push(`Primary scoreboard unavailable: ${error.message}`);
    const fallback = await fetchCoreGames(date);
    games = fallback.games;
    sourceUrl = fallback.url;
    source = "ESPN WNBA core events fallback";
    console.warn(`WNBA primary scoreboard unavailable; core fallback returned ${games.length} game(s)`);
  }
  const out = {
    sport: "WNBA",
    phase: "schedule_beta",
    source,
    sourceUrl,
    date,
    fetchedAt: new Date().toISOString(),
    count: games.length,
    availability: games.length ? "games_scheduled" : "no_games_scheduled",
    warnings,
    notes: [
      "Schedule, score, record, venue, broadcast, and team-leader context only.",
      "No WNBA player projection or betting model is active during the foundation phase."
    ],
    games
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`WNBA TODAY COMPLETE: ${games.length} game(s) for ${date}`);
}

main().catch(error => {
  console.error("WNBA TODAY FETCH FAILED");
  console.error(error);
  process.exit(1);
});
