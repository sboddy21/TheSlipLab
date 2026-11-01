import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const GAMES_FILE = path.join(ROOT, "website/data/nba_games_today.json");
const HISTORY_FILE = path.join(ROOT, "website/data/nba_history.json");
const OUT = path.join(ROOT, "website/data/nba_team_defense.json");

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

function rankRows(rows, key, rankKey, lowerIsBetter = true) {
  const sorted = [...rows].sort((a, b) =>
    lowerIsBetter ? num(a[key]) - num(b[key]) : num(b[key]) - num(a[key])
  );

  sorted.forEach((row, index) => {
    row[rankKey] = index + 1;
  });
}

function defensiveTier(rank) {
  const r = num(rank);
  if (r <= 5) return "Elite Defense";
  if (r <= 10) return "Strong Defense";
  if (r <= 20) return "Average Defense";
  if (r <= 25) return "Weak Defense";
  return "Target Defense";
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

function parseTeamDefense(data) {
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
      wins: num(row[idx.W]),
      losses: num(row[idx.L]),

      pointsAllowed: round1(row[idx.OPP_PTS]),
      reboundsAllowed: round1(row[idx.OPP_REB]),
      assistsAllowed: round1(row[idx.OPP_AST]),
      threesAllowed: round1(row[idx.OPP_FG3M]),

      opponentFGAPerGame: round1(row[idx.OPP_FGA]),
      opponentFTAPerGame: round1(row[idx.OPP_FTA]),
      opponentThreeAttempts: round1(row[idx.OPP_FG3A]),
      opponentFieldGoalPct: round1(num(row[idx.OPP_FG_PCT]) * 100),
      opponentThreePct: round1(num(row[idx.OPP_FG3_PCT]) * 100)
    };
  }).filter(t => t.teamAbbr);
}

export function parseEspnStandingsDefense(data) {
  const entries = (data?.children || []).flatMap(group => group?.standings?.entries || []);
  return entries.map(entry => {
    const stats = new Map((entry.stats || []).map(stat => [stat.name, stat.value]));
    return {
      teamId: String(entry.team?.id || ""),
      team: entry.team?.displayName || entry.team?.name || "",
      teamAbbr: entry.team?.abbreviation || "",
      games: num(stats.get("wins")) + num(stats.get("losses")),
      wins: num(stats.get("wins")),
      losses: num(stats.get("losses")),
      pointsAllowed: round1(stats.get("avgPointsAgainst")),
      reboundsAllowed: null,
      assistsAllowed: null,
      threesAllowed: null,
      opponentFGAPerGame: null,
      opponentFTAPerGame: null,
      opponentThreeAttempts: null,
      opponentFieldGoalPct: null,
      opponentThreePct: null
    };
  }).filter(team => team.teamAbbr && team.games > 0 && team.pointsAllowed > 0);
}

async function main() {
  const historyData = readJSON(HISTORY_FILE, {});
  const season = historyData.season || seasonYear();
  const gamesData = readJSON(GAMES_FILE, { games: [] });
  const games = Array.isArray(gamesData.games) ? gamesData.games : [];

  if (!games.length) {
    const out = {
      sport: "NBA",
      version: "1.1",
      source: "NBA stats leaguedashteamstats opponent per game",
      fetchedAt: new Date().toISOString(),
      date: gamesData.date || "",
      season,
      teamCount: 0,
      availability: "no_games_scheduled",
      error: "",
      modelNotes: [
        "No team-defense rows are required when the live NBA scoreboard has no scheduled games.",
        "No previous or synthetic team-defense data is reused."
      ],
      teams: []
    };

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log("NBA TEAM DEFENSE COMPLETE: NO GAMES SCHEDULED");
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
    MeasureType: "Opponent",
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

  let teams = [];
  let error = "";
  let provider = "NBA stats";
  try {
    teams = parseTeamDefense(await fetchJsonWithRetry(url));
    if (!teams.length) throw new Error("NBA team defense API returned 0 teams for a non-empty slate");
  } catch (fetchError) {
    try {
      teams = parseEspnStandingsDefense(await fetchJsonWithRetry("https://site.api.espn.com/apis/v2/sports/basketball/nba/standings"));
      if (!teams.length) throw new Error("ESPN standings returned 0 verified team-defense rows");
      provider = "ESPN standings";
    } catch (fallbackError) {
      error = `${fetchError.message}; ${fallbackError.message}`;
    }
  }

  if (teams.length) {
    rankRows(teams, "pointsAllowed", "rankPointsAllowed", true);
    if (provider === "NBA stats") {
      rankRows(teams, "reboundsAllowed", "rankReboundsAllowed", true);
      rankRows(teams, "assistsAllowed", "rankAssistsAllowed", true);
      rankRows(teams, "threesAllowed", "rankThreesAllowed", true);
      rankRows(teams, "opponentFGAPerGame", "rankOpponentFGA", true);
      rankRows(teams, "opponentThreeAttempts", "rankOpponentThreeAttempts", true);
    }

    for (const team of teams) {
      const avgAllowedRank = provider === "NBA stats" ? (
        num(team.rankPointsAllowed) +
        num(team.rankReboundsAllowed) +
        num(team.rankAssistsAllowed) +
        num(team.rankThreesAllowed)
      ) / 4 : num(team.rankPointsAllowed);

      team.overallDefenseRank = Math.round(avgAllowedRank);
      team.defensiveTier = defensiveTier(team.overallDefenseRank);

      team.pointsAllowedTier = defensiveTier(team.rankPointsAllowed);
      team.reboundsAllowedTier = provider === "NBA stats" ? defensiveTier(team.rankReboundsAllowed) : null;
      team.assistsAllowedTier = provider === "NBA stats" ? defensiveTier(team.rankAssistsAllowed) : null;
      team.threesAllowedTier = provider === "NBA stats" ? defensiveTier(team.rankThreesAllowed) : null;
    }
  }

  const out = {
    sport: "NBA",
    version: "1.2",
    source: provider === "NBA stats" ? "NBA stats leaguedashteamstats opponent per game" : "ESPN standings opponent points per game",
    fetchedAt: new Date().toISOString(),
    date: gamesData.date || "",
    season,
    teamCount: teams.length,
    availability: error ? "source_unavailable" : "games_scheduled",
    error,
    modelNotes: [
      "Team Defense 1.2 uses NBA stats opponent data, with ESPN standings opponent points per game as a verified fallback.",
      "Lower allowed values rank as stronger defense.",
      "When only ESPN is available, non-points defensive categories remain unavailable rather than estimated.",
      "No odds or betting lines are used."
    ],
    teams
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA TEAM DEFENSE COMPLETE");
  console.log("Season:", season);
  console.log("Teams:", teams.length);
  console.log("Error:", error || "none");
  console.log("Saved:", OUT);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(err => {
  console.error("NBA TEAM DEFENSE FAILED");
  console.error(err);
  process.exit(1);
});
