import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const GAMES_FILE = path.join(ROOT, "website/data/nba_games_today.json");
const OUT = path.join(ROOT, "website/data/nba_player_pool.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function teamKey(team) {
  return String(team?.abbreviation || team?.teamTricode || "").trim().toUpperCase();
}

function normalizePlayer(player, team, opponent, game, homeAway) {
  const stats = player.statistics || {};

  return {
    playerId: String(player.personId || ""),
    player: player.name || "",
    firstName: player.firstName || "",
    lastName: player.familyName || "",
    nameShort: player.nameI || "",
    jersey: player.jerseyNum || "",
    position: player.position || "",
    status: player.status || "",
    starter: String(player.starter || "") === "1",
    oncourt: String(player.oncourt || "") === "1",
    played: String(player.played || "") === "1",

    teamId: String(team.teamId || ""),
    team: team.teamName || "",
    teamCity: team.teamCity || "",
    teamAbbr: teamKey(team),

    opponentTeamId: String(opponent.teamId || ""),
    opponent: opponent.teamName || "",
    opponentCity: opponent.teamCity || "",
    opponentAbbr: teamKey(opponent),

    homeAway,
    gameId: String(game.gameId || ""),
    gameTimeUTC: game.gameTimeUTC || "",
    gameStatus: num(game.gameStatus),
    gameStatusText: game.gameStatusText || "",

    boxScore: {
      minutes: stats.minutes || "",
      minutesCalculated: stats.minutesCalculated || "",
      points: num(stats.points),
      rebounds: num(stats.reboundsTotal),
      assists: num(stats.assists),
      threesMade: num(stats.threePointersMade),
      threesAttempted: num(stats.threePointersAttempted),
      fieldGoalsMade: num(stats.fieldGoalsMade),
      fieldGoalsAttempted: num(stats.fieldGoalsAttempted),
      freeThrowsMade: num(stats.freeThrowsMade),
      freeThrowsAttempted: num(stats.freeThrowsAttempted),
      steals: num(stats.steals),
      blocks: num(stats.blocks),
      turnovers: num(stats.turnovers),
      plusMinus: num(stats.plusMinusPoints)
    }
  };
}

function normalizeTeamFromScoreboard(gameTeam, opponentTeam, game, homeAway) {
  return {
    teamId: String(gameTeam.teamId || ""),
    team: gameTeam.team || "",
    city: gameTeam.city || "",
    abbreviation: teamKey(gameTeam),
    opponent: teamKey(opponentTeam),
    homeAway,
    gameId: game.gameId,
    gameTimeUTC: game.gameTimeUTC,
    gameStatusText: game.gameStatusText
  };
}

async function main() {
  const gamesData = readJSON(GAMES_FILE, { games: [] });
  const games = Array.isArray(gamesData.games) ? gamesData.games : [];

  const teams = [];
  const players = [];
  const errors = [];

  for (const game of games) {
    if (game.homeTeam?.abbreviation) {
      teams.push(normalizeTeamFromScoreboard(game.homeTeam, game.awayTeam, game, "HOME"));
    }

    if (game.awayTeam?.abbreviation) {
      teams.push(normalizeTeamFromScoreboard(game.awayTeam, game.homeTeam, game, "AWAY"));
    }

    if (!game.gameId) continue;

    const url = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${game.gameId}.json`;

    try {
      const box = await fetchJson(url);
      const fullGame = box?.game || {};
      const home = fullGame.homeTeam || {};
      const away = fullGame.awayTeam || {};

      const homePlayers = Array.isArray(home.players) ? home.players : [];
      const awayPlayers = Array.isArray(away.players) ? away.players : [];

      for (const p of homePlayers) {
        players.push(normalizePlayer(p, home, away, fullGame, "HOME"));
      }

      for (const p of awayPlayers) {
        players.push(normalizePlayer(p, away, home, fullGame, "AWAY"));
      }
    } catch (err) {
      errors.push({
        gameId: game.gameId,
        error: err.message
      });
    }
  }

  if (errors.length) {
    throw new Error(`NBA player pool failed to load ${errors.length} scheduled game box score(s)`);
  }

  if (games.length > 0 && players.length === 0) {
    throw new Error("NBA player pool returned 0 players for a non-empty slate");
  }

  const out = {
    sport: "NBA",
    source: "NBA live box score player pool",
    fetchedAt: new Date().toISOString(),
    date: gamesData.date || "",
    gameCount: games.length,
    teamCount: teams.length,
    playerCount: players.length,
    availability: games.length ? "games_scheduled" : "no_games_scheduled",
    errors,
    teams,
    players
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA PLAYER POOL COMPLETE");
  console.log("Games:", games.length);
  console.log("Teams:", teams.length);
  console.log("Players:", players.length);
  console.log("Errors:", errors.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA PLAYER POOL FAILED");
  console.error(err);
  process.exit(1);
});
