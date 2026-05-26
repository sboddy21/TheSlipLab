import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "website", "data");

function readJSON(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, file), "utf8")
    );
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(
    path.join(DATA_DIR, file),
    JSON.stringify(data, null, 2)
  );
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  return data.games || data.players || data.rows || data.data || [];
}

function clean(v, fallback = "") {
  if (v === undefined || v === null || v === "") {
    return fallback;
  }
  return String(v);
}

function norm(v = "") {
  return clean(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function scoreOf(h) {
  return Number(
    h.score ??
    h.hrConfidence ??
    h.powerScore ??
    0
  );
}

const slatePayload = readJSON(
  "mlb_games_today.json",
  { games: [] }
);

const hrPayload = readJSON(
  "mlb_home_runs.json",
  []
);

const slateGames = rows(slatePayload);
const hitters = rows(hrPayload);

const slateMap = new Map();

for (const g of slateGames) {
  const key = norm(
    g.matchup ||
    `${g.awayTeam} at ${g.homeTeam}`
  );

  slateMap.set(key, g);
}

const groupedHitters = new Map();

for (const hitter of hitters) {
  const gameName = clean(
    hitter.game || hitter.matchup
  );

  const key = norm(gameName);

  if (!groupedHitters.has(key)) {
    groupedHitters.set(key, []);
  }

  groupedHitters.get(key).push(hitter);
}

const finalGames = [];

for (const [key, bats] of groupedHitters.entries()) {

  const slateGame = slateMap.get(key);

  if (!slateGame) {
    continue;
  }

  const awayTeam = slateGame.awayTeam;
  const homeTeam = slateGame.homeTeam;

  const awayHitters = bats
    .filter(h => norm(h.team) === norm(awayTeam))
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  const homeHitters = bats
    .filter(h => norm(h.team) === norm(homeTeam))
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  finalGames.push({
    ...slateGame,

    game:
      slateGame.matchup ||
      `${awayTeam} at ${homeTeam}`,

    matchup:
      slateGame.matchup ||
      `${awayTeam} at ${homeTeam}`,

    awayPitcher: {
      name: clean(slateGame.awayProbablePitcher, "TBD"),
      pitcher: clean(slateGame.awayProbablePitcher, "TBD"),
      id: slateGame.awayProbablePitcherId || null,
      side:
        clean(
          slateGame.awayPitcherHand ||
          slateGame.awayProbablePitcherHand
        )
    },

    homePitcher: {
      name: clean(slateGame.homeProbablePitcher, "TBD"),
      pitcher: clean(slateGame.homeProbablePitcher, "TBD"),
      id: slateGame.homeProbablePitcherId || null,
      side:
        clean(
          slateGame.homePitcherHand ||
          slateGame.homeProbablePitcherHand
        )
    },

    hitters: {
      away: awayHitters,
      home: homeHitters
    },

    topThreats: [...awayHitters, ...homeHitters]
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, 5)
      .map(h => ({
        player: h.player,
        team: h.team,
        score: scoreOf(h)
      }))
  });
}

writeJSON(
  "game_pitcher_matchups.json",
  {
    updatedAt: new Date().toISOString(),
    date: slatePayload.date || "",
    count: finalGames.length,
    games: finalGames
  }
);

console.log("");
console.log("GAME PITCHER MATCHUPS COMPLETE");
console.log("Games:", finalGames.length);
console.log("Hitters:", hitters.length);
console.log(
  "Saved:",
  path.join(DATA_DIR, "game_pitcher_matchups.json")
);
