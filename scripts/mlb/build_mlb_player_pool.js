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

function selectRelevantGame(games) {
  const ordered = games
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
      if (String(game.gamePk) !== String(selected.gamePk)) continue;
      if (!game.awayProbablePitcherId || !game.homeProbablePitcherId) {
        console.log(
          `Including analysis game with pending probable pitcher: ${game.matchup} ` +
          `gamePk ${game.gamePk}`
        );
      }
    }
  }

  return games.filter(game => selectedGamePks.has(String(game.gamePk)));
}


function mapRosterRows(rows) {
  return rows
    .filter(item => {
      const type = item?.position?.type || "";
      const playerId = item?.person?.id ?? null;
      return type !== "Pitcher" && playerId;
    })
    .map(item => ({
      playerId: item.person.id,
      player: safe(item.person?.fullName),
      jerseyNumber: safe(item.jerseyNumber),
      position: safe(item.position?.abbreviation),
      positionType: safe(item.position?.type)
    }));
}

const boxscoreCache = new Map();

async function getBoxscore(gamePk) {
  const key = String(gamePk);

  if (!boxscoreCache.has(key)) {
    boxscoreCache.set(
      key,
      getJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`)
    );
  }

  return boxscoreCache.get(key);
}

async function getRoster(teamId, gamePk, side, officialLineup) {
  const url = `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster/Active`;
  const data = await getJson(url);
  const activeRoster = mapRosterRows(data.roster || []);

  if (activeRoster.length) {
    return {
      source: "MLB_ACTIVE_ROSTER",
      players: activeRoster
    };
  }

  console.log(
    `Active roster is empty for team ${teamId}; checking official game ${gamePk} boxscore roster`
  );

  const boxscore = await getBoxscore(gamePk);
  const gamePlayers = Object.values(boxscore?.teams?.[side]?.players || {});
  const boxscoreRoster = mapRosterRows(gamePlayers);

  if (boxscoreRoster.length) {
    return {
      source: "MLB_GAME_BOXSCORE",
      players: boxscoreRoster
    };
  }

  const lineupRoster = mapRosterRows(
    (Array.isArray(officialLineup) ? officialLineup : []).map(row => ({
      person: {
        id: row?.playerId ?? row?.id ?? row?.personId,
        fullName: row?.player ?? row?.name ?? row?.fullName
      },
      jerseyNumber: row?.jerseyNumber,
      position: {
        abbreviation: row?.position,
        type: row?.positionType || "Position Player"
      }
    }))
  );

  if (lineupRoster.length) {
    return {
      source: "MLB_GAME_LINEUP",
      players: lineupRoster
    };
  }

  throw new Error(
    `MLB has not published a usable roster for team ${teamId} in game ${gamePk}`
  );
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
    throw new Error("No MLB games are available for player-pool analysis");
  }

  const pool = [];

  for (const game of analysisGames) {
    console.log(`Building pool for ${game.matchup}`);

    const awayRosterResult = await getRoster(
      game.awayTeamId,
      game.gamePk,
      "away",
      game.awayBattingOrder
    );
    const homeRosterResult = await getRoster(
      game.homeTeamId,
      game.gamePk,
      "home",
      game.homeBattingOrder
    );
    const awayRoster = awayRosterResult.players;
    const homeRoster = homeRosterResult.players;

    console.log(
      `Roster sources: ${game.awayTeam}=${awayRosterResult.source} (${awayRoster.length}), ` +
      `${game.homeTeam}=${homeRosterResult.source} (${homeRoster.length})`
    );

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
        rosterSource: awayRosterResult.source,
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
        rosterSource: homeRosterResult.source,
        lineupSpot: lineup.lineupSpot,
        lineupStatus: lineup.lineupStatus,
        lineupSource: lineup.lineupSource,
        confirmedLineup: lineup.confirmedLineup
      });
    });
  }

  if (!pool.length) {
    throw new Error("Scheduled analysis games produced no official MLB hitters");
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
