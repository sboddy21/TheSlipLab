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

    awayRoster.forEach(player => {
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
        homeAway: "away"
      });
    });

    homeRoster.forEach(player => {
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
        homeAway: "home"
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
