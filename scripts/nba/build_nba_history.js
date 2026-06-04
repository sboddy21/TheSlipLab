import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const CORE_FILE = path.join(ROOT, "website/data/nba_core.json");
const OUT = path.join(ROOT, "website/data/nba_history.json");

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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function avg(values) {
  const arr = values.map(num).filter(v => Number.isFinite(v));
  if (!arr.length) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
}

function safeName(player) {
  return String(player || "").trim();
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

async function fetchJson(url) {
  const res = await fetch(url, {
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
}

function parsePlayerGameLog(data) {
  const set = data?.resultSets?.[0] || data?.resultSet || {};
  const headers = Array.isArray(set.headers) ? set.headers : [];
  const rows = Array.isArray(set.rowSet) ? set.rowSet : [];

  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  return rows.map(row => ({
    gameId: String(row[idx.Game_ID] || row[idx.GAME_ID] || ""),
    gameDate: row[idx.GAME_DATE] || "",
    matchup: row[idx.MATCHUP] || "",
    minutes: num(row[idx.MIN]),
    points: num(row[idx.PTS]),
    rebounds: num(row[idx.REB]),
    assists: num(row[idx.AST]),
    threesMade: num(row[idx.FG3M]),
    threesAttempted: num(row[idx.FG3A]),
    fieldGoalAttempts: num(row[idx.FGA]),
    freeThrowAttempts: num(row[idx.FTA]),
    steals: num(row[idx.STL]),
    blocks: num(row[idx.BLK]),
    turnovers: num(row[idx.TOV])
  }));
}

async function fetchPlayerHistory(playerId, season) {
  const params = new URLSearchParams({
    DateFrom: "",
    DateTo: "",
    GameSegment: "",
    LastNGames: "0",
    LeagueID: "00",
    Location: "",
    MeasureType: "Base",
    Month: "0",
    OpponentTeamID: "0",
    Outcome: "",
    PORound: "0",
    PaceAdjust: "N",
    PerMode: "Totals",
    Period: "0",
    PlayerID: String(playerId),
    PlusMinus: "N",
    Rank: "N",
    Season: season,
    SeasonSegment: "",
    SeasonType: "Regular Season",
    ShotClockRange: "",
    VsConference: "",
    VsDivision: ""
  });

  const url = `https://stats.nba.com/stats/playergamelog?${params.toString()}`;
  const data = await fetchJson(url);
  return parsePlayerGameLog(data);
}

function splitHistory(games) {
  const sorted = [...games].sort((a, b) => String(b.gameDate).localeCompare(String(a.gameDate)));
  const last5 = sorted.slice(0, 5);
  const last10 = sorted.slice(0, 10);

  return {
    gamesPlayed: sorted.length,
    season: summarize(sorted),
    last5: summarize(last5),
    last10: summarize(last10),
    recentGames: sorted.slice(0, 10)
  };
}

function summarize(games) {
  return {
    games: games.length,
    minutes: avg(games.map(g => g.minutes)),
    points: avg(games.map(g => g.points)),
    rebounds: avg(games.map(g => g.rebounds)),
    assists: avg(games.map(g => g.assists)),
    threesMade: avg(games.map(g => g.threesMade)),
    threesAttempted: avg(games.map(g => g.threesAttempted)),
    fieldGoalAttempts: avg(games.map(g => g.fieldGoalAttempts)),
    freeThrowAttempts: avg(games.map(g => g.freeThrowAttempts)),
    steals: avg(games.map(g => g.steals)),
    blocks: avg(games.map(g => g.blocks)),
    turnovers: avg(games.map(g => g.turnovers))
  };
}

async function main() {
  const core = readJSON(CORE_FILE, { players: [] });
  const players = Array.isArray(core.players) ? core.players : [];
  const season = seasonYear();

  const rows = [];
  const errors = [];

  for (const player of players) {
    try {
      const games = await fetchPlayerHistory(player.playerId, season);
      const history = splitHistory(games);

      rows.push({
        playerId: player.playerId,
        player: safeName(player.player),
        team: player.teamAbbr,
        opponent: player.opponentAbbr,
        position: player.position,
        starter: Boolean(player.starter),
        status: player.status,
        season,
        ...history
      });

      console.log("OK", player.player, history.gamesPlayed);
      await sleep(450);
    } catch (err) {
      errors.push({
        playerId: player.playerId,
        player: player.player,
        team: player.teamAbbr,
        error: err.message
      });

      rows.push({
        playerId: player.playerId,
        player: safeName(player.player),
        team: player.teamAbbr,
        opponent: player.opponentAbbr,
        position: player.position,
        starter: Boolean(player.starter),
        status: player.status,
        season,
        gamesPlayed: 0,
        season: summarize([]),
        last5: summarize([]),
        last10: summarize([]),
        recentGames: []
      });

      console.log("ERR", player.player, err.message);
      await sleep(750);
    }
  }

  const out = {
    sport: "NBA",
    version: "1.0",
    source: "NBA stats player game logs",
    fetchedAt: new Date().toISOString(),
    date: core.date || "",
    season,
    playerCount: rows.length,
    errorCount: errors.length,
    errors,
    players: rows
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA HISTORY COMPLETE");
  console.log("Players:", rows.length);
  console.log("Errors:", errors.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA HISTORY FAILED");
  console.error(err);
  process.exit(1);
});
