import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const GAMES_FILE = path.join(DATA_DIR, "mlb_games_today.json");
const BOARD_FILE = path.join(DATA_DIR, "mlb_home_runs.json");
const OUT_FILE = path.join(DATA_DIR, "mlb_results.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function clean(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).trim();
}

async function getJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Request failed ${res.status}: ${url}`);
  }

  return res.json();
}

function sameName(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

function findModelMatch(hr, boardRows) {
  return boardRows.find(row =>
    sameName(row.player, hr.player) &&
    (
      sameName(row.opposingPitcher, hr.pitcher) ||
      sameName(row.game, hr.game) ||
      sameName(row.team, hr.team)
    )
  ) || null;
}

function getTeamNameFromSide(gameData, side) {
  return gameData?.teams?.[side]?.name || "";
}

function extractHomeRunsFromLiveFeed(liveFeed, game) {
  const plays = liveFeed?.liveData?.plays?.allPlays || [];
  const gameData = liveFeed?.gameData || {};

  return plays
    .filter(play => String(play?.result?.event || "").toLowerCase() === "home run")
    .map(play => {
      const about = play.about || {};
      const matchup = play.matchup || {};
      const result = play.result || {};
      const batter = matchup.batter || {};
      const pitcher = matchup.pitcher || {};
      const battingSide = matchup.batSide || {};
      const pitchHand = matchup.pitchHand || {};

      const isTop = String(about.halfInning || "").toLowerCase() === "top";
      const team = isTop
        ? getTeamNameFromSide(gameData, "away")
        : getTeamNameFromSide(gameData, "home");

      return {
        gamePk: game.gamePk,
        game: game.matchup,
        venue: game.venue,
        status: game.status,
        player: batter.fullName || "",
        playerId: batter.id || null,
        team,
        pitcher: pitcher.fullName || "",
        pitcherId: pitcher.id || null,
        batSide: battingSide.code || "",
        pitchHand: pitchHand.code || "",
        inning: about.inning || null,
        halfInning: about.halfInning || "",
        rbi: result.rbi || 0,
        description: result.description || "",
        awayScore: result.awayScore ?? game.awayScore ?? null,
        homeScore: result.homeScore ?? game.homeScore ?? null
      };
    });
}

async function main() {
  const gamesData = readJson(GAMES_FILE, { games: [] });
  const games = Array.isArray(gamesData.games) ? gamesData.games : [];
  const boardRows = readJson(BOARD_FILE, []);

  const allHomeRuns = [];

  for (const game of games) {
    try {
      const liveFeed = await getJson(`https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`);
      const hrs = extractHomeRunsFromLiveFeed(liveFeed, game);
      allHomeRuns.push(...hrs);
    } catch (err) {
      console.log(`Could not fetch HR results for ${game.gamePk}: ${err.message}`);
    }
  }

  const results = allHomeRuns.map((hr, index) => {
    const match = findModelMatch(hr, boardRows);
    const hitter = match?.stats?.hitter || {};
    const pitcherStats = match?.stats?.pitcher || {};

    return {
      rank: index + 1,
      ...hr,
      wasOnBoard: Boolean(match),
      modelScore: match?.score ?? null,
      modelEdge: match?.edge ?? "",
      modelNote: match?.note ?? "",
      hitterHrSeason: hitter.hr ?? null,
      hitterSlg: hitter.slg ?? null,
      hitterOps: hitter.ops ?? null,
      opposingPitcherEra: pitcherStats.era ?? null,
      opposingPitcherWhip: pitcherStats.whip ?? null,
      tags: [
        match ? "MODEL FLAGGED" : "NOT FLAGGED",
        match?.score >= 60 ? "HIGH SCORE" : "",
        pitcherStats?.era >= 5 ? "PITCHER LEAK" : "",
        hitter?.slg >= 0.5 ? "POWER PROFILE" : ""
      ].filter(Boolean)
    };
  });

  const flagged = results.filter(row => row.wasOnBoard).length;

  const output = {
    date: gamesData.date || new Date().toISOString().slice(0, 10),
    source: "MLB live feed plus The Slip Lab HR board",
    updatedAt: new Date().toISOString(),
    totalHomeRuns: results.length,
    modelFlaggedHomeRuns: flagged,
    modelFlagRate: results.length ? Number(((flagged / results.length) * 100).toFixed(1)) : 0,
    results
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  console.log("HR RESULTS COMPLETE");
  console.log("Home Runs:", results.length);
  console.log("Model Flagged:", flagged);
  console.log("Saved:", OUT_FILE);
}

main().catch(err => {
  console.error("Failed to build HR results");
  console.error(err.message);
  process.exit(1);
});
