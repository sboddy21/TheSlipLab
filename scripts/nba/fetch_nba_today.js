import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "website/data/nba_games_today.json");

function todayET() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const y = parts.find(p => p.type === "year")?.value || "";
  const m = parts.find(p => p.type === "month")?.value || "";
  const d = parts.find(p => p.type === "day")?.value || "";

  return `${y}-${m}-${d}`;
}

function compactDate(dateStr) {
  return String(dateStr || "").replaceAll("-", "");
}

async function fetchJson(url) {
  const res = await fetch(url, {
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

async function main() {
  const date = todayET();
  const nbaDate = compactDate(date);
  const url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";

  const raw = await fetchJson(url);

  const sourceCurrent = raw?.scoreboard?.gameDate === date;
  const games = sourceCurrent && Array.isArray(raw?.scoreboard?.games)
    ? raw.scoreboard.games.map(normalizeGame)
    : [];

  const out = {
    sport: "NBA",
    source: "NBA live scoreboard CDN",
    date,
    nbaDate,
    fetchedAt: new Date().toISOString(),
    count: games.length,
    availability: !sourceCurrent ? "schedule_unavailable" : games.length ? "games_scheduled" : "no_games_scheduled",
    sourceDate: raw?.scoreboard?.gameDate || null,
    stale: !sourceCurrent,
    error: "",
    games
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA TODAY FETCH COMPLETE");
  console.log("Date:", date);
  console.log("Games:", games.length);
  console.log("Availability:", out.availability);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA TODAY FETCH FAILED");
  console.error(err);
  process.exit(1);
});
