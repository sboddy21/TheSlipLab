import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { easternDate, normalizeNbaSchedule } from "../../website/lib/nba-live.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "website/data/nba_games_today.json");

function compactDate(dateStr) {
  return String(dateStr || "").replaceAll("-", "");
}

async function fetchJson(url, fetcher = fetch) {
  const res = await fetcher(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json,text/plain,*/*",
      "Referer": "https://www.nba.com/"
    }
  });

  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${url}`);
  }

  return await res.json();
}

function normalizeGame(g) {
  const home = g.homeTeam || {};
  const away = g.awayTeam || {};

  return {
    gameId: String(g.gameId || ""),
    gameCode: g.gameCode || "",
    gameStatus: Number(g.gameStatus || 0),
    gameStatusText: g.gameStatusText || "",
    gameTimeUTC: g.gameTimeUTC || "",
    period: Number(g.period || 0),
    clock: g.gameClock || "",
    arena: g.arenaName || "",
    city: g.arenaCity || "",
    state: g.arenaState || "",
    homeTeam: {
      teamId: String(home.teamId || ""),
      team: home.teamName || "",
      city: home.teamCity || "",
      abbreviation: home.teamTricode || "",
      score: Number(home.score || 0)
    },
    awayTeam: {
      teamId: String(away.teamId || ""),
      team: away.teamName || "",
      city: away.teamCity || "",
      abbreviation: away.teamTricode || "",
      score: Number(away.score || 0)
    }
  };
}

function normalizeEspnGame(game) {
  const status = game.state === "post" ? 3 : game.state === "in" ? 2 : 1;
  const normalizeTeam = team => ({
    teamId: String(team.id || ""),
    team: team.shortName || team.name || "",
    city: "",
    abbreviation: team.abbreviation || "",
    score: Number(team.score || 0)
  });

  return {
    gameId: String(game.id || ""),
    gameCode: "",
    gameStatus: status,
    gameStatusText: game.status || "",
    gameTimeUTC: game.date || "",
    period: Number(game.period || 0),
    clock: game.clock || "",
    arena: game.venue || "",
    city: "",
    state: "",
    homeTeam: normalizeTeam(game.home),
    awayTeam: normalizeTeam(game.away)
  };
}

export async function buildNbaToday({ now = Date.now(), fetcher = fetch } = {}) {
  const date = easternDate(now);
  const nbaDate = compactDate(date);
  const nbaUrl = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
  const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${nbaDate}&limit=100`;
  let games = [];
  let source = "NBA live scoreboard CDN";
  let sourceUrl = nbaUrl;
  let sourceDate = null;
  let fallbackReason = "";

  try {
    const raw = await fetchJson(nbaUrl, fetcher);
    sourceDate = raw?.scoreboard?.gameDate || null;
    if (sourceDate !== date || !Array.isArray(raw?.scoreboard?.games)) {
      throw new Error(`NBA CDN slate date ${sourceDate || "missing"} did not match ${date}`);
    }
    games = raw.scoreboard.games.map(normalizeGame);
  } catch (error) {
    fallbackReason = error.message;
    const raw = await fetchJson(espnUrl, fetcher);
    games = normalizeNbaSchedule(raw, date).map(normalizeEspnGame);
    source = "ESPN date-specific NBA scoreboard";
    sourceUrl = espnUrl;
    sourceDate = date;
  }

  return {
    sport: "NBA",
    source,
    sourceUrl,
    date,
    nbaDate,
    fetchedAt: new Date(now).toISOString(),
    count: games.length,
    availability: games.length ? "games_scheduled" : "no_games_scheduled",
    sourceDate,
    stale: false,
    error: "",
    fallbackReason,
    games
  };
}

async function main() {
  const out = await buildNbaToday();

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA TODAY FETCH COMPLETE");
  console.log("Date:", out.date);
  console.log("Games:", out.games.length);
  console.log("Availability:", out.availability);
  console.log("Source:", out.source);
  console.log("Saved:", OUT);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err => {
    console.error("NBA TODAY FETCH FAILED");
    console.error(err);
    process.exit(1);
  });
}
