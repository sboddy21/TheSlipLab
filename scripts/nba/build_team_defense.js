import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
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

function buildFallbackTeam(teamAbbr) {
  return {
    teamId: "",
    team: teamAbbr,
    teamAbbr,
    games: 0,
    wins: 0,
    losses: 0,
    pointsAllowed: 0,
    reboundsAllowed: 0,
    assistsAllowed: 0,
    threesAllowed: 0,
    opponentFGAPerGame: 0,
    opponentFTAPerGame: 0,
    opponentThreeAttempts: 0,
    opponentFieldGoalPct: 0,
    opponentThreePct: 0,
    rankPointsAllowed: 15,
    rankReboundsAllowed: 15,
    rankAssistsAllowed: 15,
    rankThreesAllowed: 15,
    rankOpponentFGA: 15,
    rankOpponentThreeAttempts: 15,
    overallDefenseRank: 15,
    defensiveTier: "Average Defense",
    pointsAllowedTier: "Average Defense",
    reboundsAllowedTier: "Average Defense",
    assistsAllowedTier: "Average Defense",
    threesAllowedTier: "Average Defense"
  };
}

async function main() {
  const season = seasonYear();

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
  let error = null;

  try {
    const data = await fetchJsonWithRetry(url);
    teams = parseTeamDefense(data);
  } catch (err) {
    error = err.message;
    const previous = readJSON(OUT, { teams: [] });
    teams = Array.isArray(previous.teams) ? previous.teams : [];
    console.log("NBA TEAM DEFENSE USING PREVIOUS DATA:", error);
  }

  if (!teams.length) {
    teams = Object.values(TEAM_ABBR).map(buildFallbackTeam);
  } else {
    rankRows(teams, "pointsAllowed", "rankPointsAllowed", true);
    rankRows(teams, "reboundsAllowed", "rankReboundsAllowed", true);
    rankRows(teams, "assistsAllowed", "rankAssistsAllowed", true);
    rankRows(teams, "threesAllowed", "rankThreesAllowed", true);
    rankRows(teams, "opponentFGAPerGame", "rankOpponentFGA", true);
    rankRows(teams, "opponentThreeAttempts", "rankOpponentThreeAttempts", true);

    for (const team of teams) {
      const avgAllowedRank = (
        num(team.rankPointsAllowed) +
        num(team.rankReboundsAllowed) +
        num(team.rankAssistsAllowed) +
        num(team.rankThreesAllowed)
      ) / 4;

      team.overallDefenseRank = Math.round(avgAllowedRank);
      team.defensiveTier = defensiveTier(team.overallDefenseRank);

      team.pointsAllowedTier = defensiveTier(team.rankPointsAllowed);
      team.reboundsAllowedTier = defensiveTier(team.rankReboundsAllowed);
      team.assistsAllowedTier = defensiveTier(team.rankAssistsAllowed);
      team.threesAllowedTier = defensiveTier(team.rankThreesAllowed);
    }
  }

  const out = {
    sport: "NBA",
    version: "1.1",
    source: error ? "Previous NBA team defense data fallback" : "NBA stats leaguedashteamstats opponent per game",
    fetchedAt: new Date().toISOString(),
    season,
    teamCount: teams.length,
    error: error || "",
    modelNotes: [
      "Team Defense 1.1 uses NBA stats opponent per game team data when available.",
      "Lower allowed values rank as stronger defense.",
      "If NBA stats times out, the file keeps the previous usable team defense snapshot.",
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

main().catch(err => {
  console.error("NBA TEAM DEFENSE FAILED");
  console.error(err);
  process.exit(1);
});
