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

async function main() {
  const date = todayET();

  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,venue`;

  console.log("Fetching MLB games for", date);

  const data = await getJson(url);
  const gamesRaw = data?.dates?.[0]?.games || [];

  const games = gamesRaw.map(game => {
    return {
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: safe(game.status?.detailedState, "Unknown"),
      abstractStatus: safe(game.status?.abstractGameState, "Unknown"),

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

      matchup: `${safe(game.teams?.away?.team?.name)} at ${safe(game.teams?.home?.team?.name)}`
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
