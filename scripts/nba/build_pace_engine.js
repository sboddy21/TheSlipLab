import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const GAMES_FILE = path.join(ROOT, "website/data/nba_games_today.json");
const OUT = path.join(ROOT, "website/data/nba_pace_engine.json");

const FETCH_TIMEOUT_MS = 8000;
const RETRY_WAIT_MS = 600;

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function seasonYear() {
  const now = new Date();

  const year = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric"
  }).format(now));

  const month = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric"
  }).format(now));

  const start = month >= 10 ? year : year - 1;
  const end = String(start + 1).slice(-2);

  return `${start}-${end}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(v) {
  return Math.round(num(v) * 10) / 10;
}

async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.nba.com",
        "Referer": "https://www.nba.com/",
        "x-nba-stats-origin": "stats",
        "x-nba-stats-token": "true"
      }
    });

    if (!res.ok) {
      throw new Error(`Fetch failed ${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry(url) {
  try {
    return await fetchJson(url);
  } catch (err) {
    await sleep(RETRY_WAIT_MS);
    return await fetchJson(url);
  }
}

const TEAM_ABBR = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "LA Clippers": "LAC",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS"
};

function paceTier(rank) {
  const r = num(rank);
  if (r <= 5) return "Very Fast Pace";
  if (r <= 10) return "Fast Pace";
  if (r <= 20) return "Neutral Pace";
  if (r <= 25) return "Slow Pace";
  return "Very Slow Pace";
}

function parseRows(data) {
  const set = data?.resultSets?.[0] || data?.resultSet || {};
  const headers = Array.isArray(set.headers) ? set.headers : [];
  const rows = Array.isArray(set.rowSet) ? set.rowSet : [];
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  return rows.map(row => {
    const team = row[idx.TEAM_NAME] || "";

    return {
      teamId: String(row[idx.TEAM_ID] || ""),
      team,
      teamAbbr: TEAM_ABBR[team] || "",
      games: num(row[idx.GP]),
      pace: round1(row[idx.PACE]),
      possessions: round1(row[idx.POSS]),
      offensiveRating: round1(row[idx.OFF_RATING]),
      defensiveRating: round1(row[idx.DEF_RATING]),
      netRating: round1(row[idx.NET_RATING])
    };
  }).filter(t => t.teamAbbr && t.pace > 0);
}

function applyPaceRanks(teams) {
  teams
    .slice()
    .sort((a, b) => b.pace - a.pace)
    .forEach((team, index) => {
      const target = teams.find(t => t.teamAbbr === team.teamAbbr);
      target.rankPace = index + 1;
      target.paceTier = paceTier(index + 1);
    });

  teams.sort((a, b) => a.rankPace - b.rankPace);
}

async function main() {
  const season = seasonYear();
  const gamesData = readJSON(GAMES_FILE, { games: [] });
  const games = Array.isArray(gamesData.games) ? gamesData.games : [];

  if (!games.length) {
    const out = {
      sport: "NBA",
      version: "1.1",
      source: "NBA stats leaguedashteamstats advanced per game",
      fetchedAt: new Date().toISOString(),
      date: gamesData.date || "",
      season,
      teamCount: 0,
      availability: "no_games_scheduled",
      error: "",
      modelNotes: [
        "No pace rows are required when the live NBA scoreboard has no scheduled games.",
        "No previous or synthetic pace data is reused."
      ],
      teams: []
    };

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log("NBA PACE ENGINE COMPLETE: NO GAMES SCHEDULED");
    console.log("Saved:", OUT);
    return;
  }

  const params = new URLSearchParams({
    Conference: "",
    DateFrom: "",
    DateTo: "",
    Division: "",
    GameScope: "",
    GameSegment: "",
    LastNGames: "0",
    LeagueID: "00",
    Location: "",
    MeasureType: "Advanced",
    Month: "0",
    OpponentTeamID: "0",
    Outcome: "",
    PORound: "0",
    PaceAdjust: "N",
    PerMode: "PerGame",
    Period: "0",
    PlayerExperience: "",
    PlayerPosition: "",
    PlusMinus: "N",
    Rank: "N",
    Season: season,
    SeasonSegment: "",
    SeasonType: "Regular Season",
    ShotClockRange: "",
    StarterBench: "",
    TeamID: "0",
    TwoWay: "0",
    VsConference: "",
    VsDivision: ""
  });

  const url = `https://stats.nba.com/stats/leaguedashteamstats?${params.toString()}`;

  const data = await fetchJsonWithRetry(url);
  const teams = parseRows(data);

  if (!teams.length) {
    throw new Error("NBA pace API returned 0 teams for a non-empty slate");
  }

  applyPaceRanks(teams);

  const out = {
    sport: "NBA",
    version: "1.1",
    source: "NBA stats leaguedashteamstats advanced per game",
    fetchedAt: new Date().toISOString(),
    date: gamesData.date || "",
    season,
    teamCount: teams.length,
    availability: "games_scheduled",
    error: "",
    modelNotes: [
      "Pace Engine 1.1 uses NBA stats advanced team pace when available.",
      "Higher pace ranks as faster game environment.",
      "If NBA stats is unavailable, the builder fails instead of reusing an earlier snapshot.",
      "No odds or betting lines are used."
    ],
    teams
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA PACE ENGINE COMPLETE");
  console.log("Season:", season);
  console.log("Teams:", teams.length);
  console.log("Error: none");
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA PACE ENGINE FAILED");
  console.error(err);
  process.exit(1);
});
