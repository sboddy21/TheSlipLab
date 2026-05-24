import fs from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "website", "data");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(data, null, 2));
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.games)) return data.games;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.players)) return data.players;
  return [];
}

function clean(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function gameKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\bat\b/g, "@")
    .replace(/\s*@\s*/g, " @ ")
    .trim();
}

function teamKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function splitGameName(game) {
  const text = clean(game);

  if (text.includes(" at ")) {
    const [away, home] = text.split(" at ");
    return { awayTeam: away.trim(), homeTeam: home.trim() };
  }

  if (text.includes(" @ ")) {
    const [away, home] = text.split(" @ ");
    return { awayTeam: away.trim(), homeTeam: home.trim() };
  }

  return { awayTeam: "", homeTeam: "" };
}

const games = rows(readJSON("mlb_games_today.json", []));
const profilesFile = readJSON("player_card_profiles.json", { players: [] });
const profiles = rows(profilesFile);

const map = new Map();

for (const game of games) {
  const awayTeam =
    game.awayTeam ||
    game.away_team ||
    game.away ||
    splitGameName(game.game).awayTeam;

  const homeTeam =
    game.homeTeam ||
    game.home_team ||
    game.home ||
    splitGameName(game.game).homeTeam;

  const name =
    game.game ||
    game.matchup ||
    `${awayTeam} at ${homeTeam}`;

  const key = gameKey(name);

  map.set(key, {
    game: name,
    gameKey: key,
    awayTeam,
    homeTeam,
    venue: game.venue || game.ballpark || "",
    commenceTime: game.commence_time || game.gameDate || game.startTime || "",
    awayPitcher: {
      team: awayTeam,
      pitcher: game.awayProbablePitcher || game.away_pitcher || game.awayPitcher || "TBD",
      throws: game.awayPitcherHand || "",
      era: 0,
      whip: 0,
      strikeOuts: 0,
      inningsPitched: 0,
      homeRuns: 0,
      hitterCount: 0,
      topThreats: []
    },
    homePitcher: {
      team: homeTeam,
      pitcher: game.homeProbablePitcher || game.home_pitcher || game.homePitcher || "TBD",
      throws: game.homePitcherHand || "",
      era: 0,
      whip: 0,
      strikeOuts: 0,
      inningsPitched: 0,
      homeRuns: 0,
      hitterCount: 0,
      topThreats: []
    }
  });
}

for (const profile of profiles) {
  const key = gameKey(profile.game);
  const matchup = map.get(key);

  if (!matchup) continue;

  const hitterTeam = teamKey(profile.team);
  const opponentTeam = teamKey(profile.opponent);
  const awayTeam = teamKey(matchup.awayTeam);
  const homeTeam = teamKey(matchup.homeTeam);

  let pitcherSide = null;

  if (opponentTeam === awayTeam) pitcherSide = "awayPitcher";
  if (opponentTeam === homeTeam) pitcherSide = "homePitcher";

  if (!pitcherSide) {
    if (hitterTeam === awayTeam) pitcherSide = "homePitcher";
    if (hitterTeam === homeTeam) pitcherSide = "awayPitcher";
  }

  if (!pitcherSide) continue;

  const card = matchup[pitcherSide];

  if (profile.pitcher && profile.pitcher !== "TBD") {
    card.pitcher = profile.pitcher;
  }

  const ps = profile.pitcherStats || {};

  card.era = card.era || num(ps.era);
  card.whip = card.whip || num(ps.whip);
  card.strikeOuts = card.strikeOuts || num(ps.strikeOuts);
  card.inningsPitched = card.inningsPitched || num(ps.inningsPitched);
  card.homeRuns = card.homeRuns || num(ps.homeRuns);
  card.hitterCount += 1;

  card.topThreats.push({
    player: profile.player,
    team: profile.team,
    score: num(profile.score),
    edge: profile.edge || "",
    odds: profile.odds || "N/A"
  });
}

const matchups = [...map.values()].map(game => {
  for (const side of ["awayPitcher", "homePitcher"]) {
    game[side].topThreats = game[side].topThreats
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  return game;
});

writeJSON("mlb_game_pitcher_matchups.json", {
  updatedAt: new Date().toISOString(),
  count: matchups.length,
  games: matchups
});

console.log("GAME PITCHER MATCHUPS COMPLETE");
console.log("Games:", matchups.length);
console.log("Saved: website/data/mlb_game_pitcher_matchups.json");
