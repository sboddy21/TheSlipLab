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

async function main() {
  const date = process.env.WNBA_DATE || todayET();
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${compactDate(date)}`;
  const response = await fetch(url, {
    headers: { "Accept": "application/json,text/plain,*/*", "User-Agent": "TheSlipLab/1.0 (+https://www.thesliplab.com/)" }
  });
  if (!response.ok) throw new Error(`WNBA scoreboard fetch failed: ${response.status}`);
  const raw = await response.json();
  const games = Array.isArray(raw.events) ? raw.events.map(normalizeGame) : [];
  const out = {
    sport: "WNBA",
    phase: "schedule_beta",
    source: "ESPN WNBA scoreboard feed",
    sourceUrl: url,
    date,
    fetchedAt: new Date().toISOString(),
    count: games.length,
    availability: games.length ? "games_scheduled" : "no_games_scheduled",
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
