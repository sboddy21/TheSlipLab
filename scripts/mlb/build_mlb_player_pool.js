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

  const pool = [];

  for (const game of games) {
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
