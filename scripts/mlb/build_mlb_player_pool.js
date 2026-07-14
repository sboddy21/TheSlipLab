import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const GAMES_FILE = path.join(ROOT, "website", "data", "mlb_games_today.json");
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_player_pool.json");

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return res.json();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function safe(value, fallback = "") {
  return value ?? fallback;
}

function lineupMap(rows) {
  const map = new Map();

  if (!Array.isArray(rows)) return map;

  for (const row of rows) {
    const playerId = row?.playerId ?? row?.id ?? row?.personId;
    const name = row?.player ?? row?.name ?? row?.fullName;
    const spot = Number(row?.order ?? row?.lineupSpot ?? row?.battingOrder ?? row?.spot);

    const entry = {
      lineupSpot: Number.isFinite(spot) && spot > 0 ? spot : null,
      lineupStatus: "CONFIRMED",
      lineupSource: "MLB_STATS_API",
      confirmedLineup: true
    };

    if (playerId) map.set(String(playerId), entry);
    if (name) map.set(String(name).toLowerCase(), entry);
  }

  return map;
}

function lineupInfo(player, map, confirmed, battingOrder) {
  const entry =
    map.get(String(player.playerId || "")) ||
    map.get(String(player.player || "").toLowerCase());

  if (entry) return entry;

  const lineupPosted = Boolean(confirmed) || (Array.isArray(battingOrder) && battingOrder.length > 0);

  return {
    lineupSpot: null,
    lineupStatus: lineupPosted ? "NOT IN LINEUP" : "PROJECTED",
    lineupSource: lineupPosted ? "MLB_STATS_API" : "PROJECTED",
    confirmedLineup: false
  };
}

function gameState(game) {
  const status = `${game?.abstractStatus || ""} ${game?.status || ""}`.toLowerCase();

  if (
    status.includes("live") ||
    status.includes("in progress") ||
    status.includes("warmup") ||
    status.includes("delayed") ||
    status.includes("suspended")
  ) {
    return "live";
  }

  if (
    status.includes("preview") ||
    status.includes("scheduled") ||
    status.includes("pre-game") ||
    status.includes("pregame")
  ) {
    return "upcoming";
  }

  if (
    status.includes("final") ||
    status.includes("completed") ||
    status.includes("game over")
  ) {
    return "final";
  }

  return "unavailable";
}

function matchupKey(game) {
  return [String(game.awayTeamId), String(game.homeTeamId)].sort().join("|");
}

function isAnalysisReady(game) {
  return Boolean(game?.awayProbablePitcherId && game?.homeProbablePitcherId);
}

function selectRelevantGame(games) {
  const ordered = games
    .filter(isAnalysisReady)
    .sort((a, b) => Date.parse(a.gameDate) - Date.parse(b.gameDate));

  if (!ordered.length) return null;

  const live = ordered.filter(game => gameState(game) === "live");
  const upcoming = ordered.filter(game => gameState(game) === "upcoming");
  const finals = ordered.filter(game => gameState(game) === "final");

  if (live.length) return live[0];
  if (upcoming.length) return upcoming[0];
  if (finals.length) return finals[finals.length - 1];

  return ordered[0];
}

function selectAnalysisGames(games) {
  const repeatedMatchups = new Map();

  for (const game of games) {
    const key = matchupKey(game);
    if (!repeatedMatchups.has(key)) repeatedMatchups.set(key, []);
    repeatedMatchups.get(key).push(game);
  }

  const selectedGamePks = new Set();

  for (const matchupGames of repeatedMatchups.values()) {
    const selected = selectRelevantGame(matchupGames);

    if (!selected) {
      for (const game of matchupGames) {
        console.log(
          `Skipping analysis until both probable pitchers are announced: ${game.matchup} ` +
          `gamePk ${game.gamePk}`
        );
      }
      continue;
    }

    selectedGamePks.add(String(selected.gamePk));

    if (matchupGames.length > 1) {
      console.log(
        `Doubleheader analysis game selected: ${selected.matchup} gamePk ${selected.gamePk} ` +
        `(${gameState(selected)}, ${selected.gameDate}) from ${matchupGames.length} scheduled games`
      );
    }

    for (const game of matchupGames) {
      if (!isAnalysisReady(game)) {
        console.log(
          `Skipping analysis until both probable pitchers are announced: ${game.matchup} ` +
          `gamePk ${game.gamePk}`
        );
      }
    }
  }

  return games.filter(game => selectedGamePks.has(String(game.gamePk)));
}


async function getRoster(teamId) {
  const url = `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster/Active`;
  const data = await getJson(url);

  return (data.roster || [])
    .filter(item => {
      const type = item.position?.type || "";
      return type !== "Pitcher";
    })
    .map(item => ({
      playerId: item.person?.id ?? null,
      player: safe(item.person?.fullName),
      jerseyNumber: safe(item.jerseyNumber),
      position: safe(item.position?.abbreviation),
      positionType: safe(item.position?.type)
    }));
}

async function main() {
  if (!fs.existsSync(GAMES_FILE)) {
    throw new Error("Missing website/data/mlb_games_today.json. Run npm run mlb:today first.");
  }

  const gamesData = readJson(GAMES_FILE);
  const games = gamesData.games || [];
  const analysisGames = selectAnalysisGames(games);

  if (!games.length) {
    const output = {
      date: gamesData.date,
      source: "MLB Stats API",
      updatedAt: new Date().toISOString(),
      availability: "no_games_scheduled",
      playerCount: 0,
      players: []
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
    console.log("MLB player pool saved");
    console.log("Availability: no games scheduled");
    console.log("Players: 0");
    console.log("File:", OUT_FILE);
    return;
  }

  if (!analysisGames.length) {
    throw new Error("No MLB games currently have both probable pitchers announced");
  }

  const pool = [];

  for (const game of analysisGames) {
    console.log(`Building pool for ${game.matchup}`);

    const awayRoster = await getRoster(game.awayTeamId);
    const homeRoster = await getRoster(game.homeTeamId);

    const awayLineupMap = lineupMap(game.awayBattingOrder);
    const homeLineupMap = lineupMap(game.homeBattingOrder);

    awayRoster.forEach(player => {
      const lineup = lineupInfo(
        player,
        awayLineupMap,
        game.awayConfirmedLineup,
        game.awayBattingOrder
      );

      pool.push({
        ...player,
        team: game.awayTeam,
        teamId: game.awayTeamId,
        opponent: game.homeTeam,
        opponentId: game.homeTeamId,
        gamePk: game.gamePk,
        game: game.matchup,
        venue: game.venue,
        gameDate: game.gameDate,
        opposingProbablePitcher: game.homeProbablePitcher,
        opposingProbablePitcherId: game.homeProbablePitcherId,
        homeAway: "away",
        lineupSpot: lineup.lineupSpot,
        lineupStatus: lineup.lineupStatus,
        lineupSource: lineup.lineupSource,
        confirmedLineup: lineup.confirmedLineup
      });
    });

    homeRoster.forEach(player => {
      const lineup = lineupInfo(
        player,
        homeLineupMap,
        game.homeConfirmedLineup,
        game.homeBattingOrder
      );

      pool.push({
        ...player,
        team: game.homeTeam,
        teamId: game.homeTeamId,
        opponent: game.awayTeam,
        opponentId: game.awayTeamId,
        gamePk: game.gamePk,
        game: game.matchup,
        venue: game.venue,
        gameDate: game.gameDate,
        opposingProbablePitcher: game.awayProbablePitcher,
        opposingProbablePitcherId: game.awayProbablePitcherId,
        homeAway: "home",
        lineupSpot: lineup.lineupSpot,
        lineupStatus: lineup.lineupStatus,
        lineupSource: lineup.lineupSource,
        confirmedLineup: lineup.confirmedLineup
      });
    });
  }

  const output = {
    date: gamesData.date,
    source: "MLB Stats API",
    updatedAt: new Date().toISOString(),
    playerCount: pool.length,
    players: pool
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  console.log("MLB player pool saved");
  console.log("Players:", pool.length);
  console.log("File:", OUT_FILE);
}

main().catch(err => {
  console.error("Failed to build MLB player pool");
  console.error(err.message);
  process.exit(1);
});
