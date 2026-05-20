import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_games_today.json");

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function safe(value, fallback = "") {
  return value ?? fallback;
}

async function getJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Request failed ${res.status}: ${url}`);
  }

  return res.json();
}

function getPlayerName(boxscore, playerId) {
  if (!playerId) return "";

  const player =
    boxscore?.teams?.away?.players?.[`ID${playerId}`] ||
    boxscore?.teams?.home?.players?.[`ID${playerId}`];

  return player?.person?.fullName || "";
}

function getTeamLineup(liveFeed, side) {
  const boxscore = liveFeed?.liveData?.boxscore || {};
  const team = boxscore?.teams?.[side] || {};
  const battingOrder = Array.isArray(team?.battingOrder) ? team.battingOrder : [];
  const players = team?.players || {};

  const lineup = battingOrder.map((playerId, index) => {
    const player = players[`ID${playerId}`] || {};
    const position = player?.position?.abbreviation || "";
    const name = player?.person?.fullName || getPlayerName(boxscore, playerId);

    return {
      order: index + 1,
      playerId,
      player: name,
      position
    };
  });

  const status = lineup.length >= 9 ? "CONFIRMED" : lineup.length > 0 ? "PARTIAL" : "NOT POSTED";

  return {
    status,
    confirmed: lineup.length >= 9,
    count: lineup.length,
    lineup
  };
}

async function getLiveGameDetails(gamePk) {
  try {
    const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
    const liveFeed = await getJson(url);

    const away = getTeamLineup(liveFeed, "away");
    const home = getTeamLineup(liveFeed, "home");

    const status =
      liveFeed?.gameData?.status?.detailedState ||
      liveFeed?.gameData?.status?.abstractGameState ||
      "";

    const currentInning = liveFeed?.liveData?.linescore?.currentInning || null;
    const inningState = liveFeed?.liveData?.linescore?.inningState || "";
    const inningHalf = liveFeed?.liveData?.linescore?.inningHalf || "";

    return {
      liveStatus: status,
      currentInning,
      inningState,
      inningHalf,

      awayLineupStatus: away.status,
      awayConfirmedLineup: away.confirmed,
      awayLineupCount: away.count,
      awayBattingOrder: away.lineup,

      homeLineupStatus: home.status,
      homeConfirmedLineup: home.confirmed,
      homeLineupCount: home.count,
      homeBattingOrder: home.lineup,

      lineupLockStatus:
        away.confirmed && home.confirmed
          ? "BOTH CONFIRMED"
          : away.confirmed || home.confirmed
            ? "PARTIAL CONFIRMED"
            : "NOT POSTED"
    };
  } catch (err) {
    console.log(`Live feed unavailable for ${gamePk}: ${err.message}`);

    return {
      liveStatus: "",
      currentInning: null,
      inningState: "",
      inningHalf: "",

      awayLineupStatus: "NOT POSTED",
      awayConfirmedLineup: false,
      awayLineupCount: 0,
      awayBattingOrder: [],

      homeLineupStatus: "NOT POSTED",
      homeConfirmedLineup: false,
      homeLineupCount: 0,
      homeBattingOrder: [],

      lineupLockStatus: "NOT POSTED"
    };
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

async function main() {
  const date = todayET();

  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,venue`;

  console.log("Fetching MLB games for", date);

  const data = await getJson(url);
  const gamesRaw = data?.dates?.[0]?.games || [];

  console.log("Fetching live lineup data");

  const games = await mapWithConcurrency(gamesRaw, 4, async game => {
    const live = await getLiveGameDetails(game.gamePk);

    return {
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: safe(live.liveStatus || game.status?.detailedState, "Unknown"),
      abstractStatus: safe(game.status?.abstractGameState, "Unknown"),
      currentInning: live.currentInning,
      inningState: live.inningState,
      inningHalf: live.inningHalf,

      awayTeam: safe(game.teams?.away?.team?.name),
      awayTeamId: game.teams?.away?.team?.id ?? null,
      awayScore: game.teams?.away?.score ?? null,

      homeTeam: safe(game.teams?.home?.team?.name),
      homeTeamId: game.teams?.home?.team?.id ?? null,
      homeScore: game.teams?.home?.score ?? null,

      awayProbablePitcher: safe(game.teams?.away?.probablePitcher?.fullName, "TBD"),
      awayProbablePitcherId: game.teams?.away?.probablePitcher?.id ?? null,

      homeProbablePitcher: safe(game.teams?.home?.probablePitcher?.fullName, "TBD"),
      homeProbablePitcherId: game.teams?.home?.probablePitcher?.id ?? null,

      venue: safe(game.venue?.name),
      venueId: game.venue?.id ?? null,

      matchup: `${safe(game.teams?.away?.team?.name)} at ${safe(game.teams?.home?.team?.name)}`,

      awayLineupStatus: live.awayLineupStatus,
      awayConfirmedLineup: live.awayConfirmedLineup,
      awayLineupCount: live.awayLineupCount,
      awayBattingOrder: live.awayBattingOrder,

      homeLineupStatus: live.homeLineupStatus,
      homeConfirmedLineup: live.homeConfirmedLineup,
      homeLineupCount: live.homeLineupCount,
      homeBattingOrder: live.homeBattingOrder,

      lineupLockStatus: live.lineupLockStatus
    };
  });

  const output = {
    date,
    source: "MLB Stats API",
    updatedAt: new Date().toISOString(),
    gameCount: games.length,
    games
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  console.log("MLB games saved");
  console.log("Games:", games.length);
  console.log("File:", OUT_FILE);
}

main().catch(err => {
  console.error("Failed to fetch MLB games");
  console.error(err.message);
  process.exit(1);
});
