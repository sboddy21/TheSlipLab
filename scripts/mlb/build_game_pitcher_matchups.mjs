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
  return data.players || data.games || data.rows || data.data || [];
}

function clean(v, fallback = "") {
  if (v === undefined || v === null || v === "") return fallback;
  return String(v);
}

function norm(v = "") {
  return clean(v).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pitcherObj(name, id, side) {
  return {
    name: clean(name, "TBD"),
    pitcher: clean(name, "TBD"),
    id: id ?? null,
    side: clean(side)
  };
}

const gamesPayload = readJSON("mlb_games_today.json", { games: [] });
const hrPayload = readJSON("mlb_home_runs.json", []);
const games = rows(gamesPayload);
const hitters = rows(hrPayload);

const hittersByGame = new Map();

for (const hitter of hitters) {
  const gameKey = norm(hitter.game || hitter.matchup);
  if (!gameKey) continue;

  if (!hittersByGame.has(gameKey)) {
    hittersByGame.set(gameKey, []);
  }

  hittersByGame.get(gameKey).push(hitter);
}

const finalGames = games.map(game => {
  const gameName = game.matchup || `${game.awayTeam} at ${game.homeTeam}`;
  const gameHitters = hittersByGame.get(norm(gameName)) || [];

  const awayHitters = gameHitters
    .filter(h => norm(h.team) === norm(game.awayTeam))
    .sort((a, b) => num(b.score || b.hrConfidence || b.powerScore) - num(a.score || a.hrConfidence || a.powerScore));

  const homeHitters = gameHitters
    .filter(h => norm(h.team) === norm(game.homeTeam))
    .sort((a, b) => num(b.score || b.hrConfidence || b.powerScore) - num(a.score || a.hrConfidence || a.powerScore));

  return {
    ...game,
    game: gameName,
    matchup: gameName,
    awayPitcher: pitcherObj(game.awayProbablePitcher, game.awayProbablePitcherId, game.awayPitcherHand || game.awayProbablePitcherHand),
    homePitcher: pitcherObj(game.homeProbablePitcher, game.homeProbablePitcherId, game.homePitcherHand || game.homeProbablePitcherHand),
    hitters: {
      away: awayHitters,
      home: homeHitters
    },
    topThreats: [...awayHitters, ...homeHitters]
      .sort((a, b) => num(b.score || b.hrConfidence || b.powerScore) - num(a.score || a.hrConfidence || a.powerScore))
      .slice(0, 5)
      .map(h => ({
        player: h.player,
        team: h.team,
        score: h.score || h.hrConfidence || h.powerScore
      }))
  };
});

writeJSON("game_pitcher_matchups.json", {
  updatedAt: new Date().toISOString(),
  date: gamesPayload.date || "",
  count: finalGames.length,
  games: finalGames
});

console.log("");
console.log("GAME PITCHER MATCHUPS BUILT");
console.log("Games:", finalGames.length);
console.log("Hitters:", hitters.length);
console.log("File: website/data/game_pitcher_matchups.json");
