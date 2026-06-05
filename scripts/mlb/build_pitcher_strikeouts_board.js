import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const GAMES_FILE = path.join(ROOT, "website", "data", "game_pitcher_matchups.json");
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_pitcher_strikeouts.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return res.json();
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return payload.matchups || payload.games || payload.players || payload.rows || payload.data || [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scale(value, min, max) {
  const n = num(value);
  return Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100));
}

function pitcherFrom(game, side) {
  const isAway = side === "away";
  const existing = isAway ? game.awayPitcher : game.homePitcher;

  return {
    pitcherId:
      existing?.id ||
      existing?.playerId ||
      existing?.pitcherId ||
      (isAway ? game.awayProbablePitcherId : game.homeProbablePitcherId),
    pitcher:
      existing?.name ||
      existing?.pitcher ||
      (isAway ? game.awayProbablePitcher : game.homeProbablePitcher),
    team: isAway ? game.awayTeam : game.homeTeam,
    opponent: isAway ? game.homeTeam : game.awayTeam,
    game: `${game.awayTeam || ""} at ${game.homeTeam || ""}`.trim(),
    side
  };
}

async function getPitcherStats(playerId) {
  if (!playerId) return null;

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching`;
  const data = await getJson(url);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};

  const innings = num(stat.inningsPitched);
  const strikeOuts = num(stat.strikeOuts);
  const battersFaced = num(stat.battersFaced);

  return {
    era: num(stat.era),
    whip: num(stat.whip),
    strikeOuts,
    inningsPitched: innings,
    battersFaced,
    gamesStarted: num(stat.gamesStarted),
    kPer9: innings > 0 ? Number(((strikeOuts / innings) * 9).toFixed(2)) : 0,
    kRate: battersFaced > 0 ? Number((strikeOuts / battersFaced).toFixed(3)) : 0
  };
}

function opponentKContext(game, side) {
  const hitters = side === "away" ? game.hitters?.home || [] : game.hitters?.away || [];
  const sampled = hitters.slice(0, 9);
  if (!sampled.length) return { avgStrikeOuts: 0, hitters: 0 };

  const totalKs = sampled.reduce((sum, row) => {
    const stats = row?.hitterStats || row?.stats?.hitter || row?.stats || {};
    return sum + num(stats.strikeOuts ?? row.strikeOuts);
  }, 0);

  return {
    avgStrikeOuts: totalKs / sampled.length,
    hitters: sampled.length
  };
}

function buildScore(pitcher, opponentCtx) {
  if (!pitcher) return 0;

  const pitcherStrength =
    scale(pitcher.kPer9, 4.5, 13.5) * 0.46 +
    scale(pitcher.kRate, 0.120, 0.340) * 0.28 +
    scale(pitcher.strikeOuts, 20, 230) * 0.16 +
    scale(pitcher.gamesStarted, 3, 32) * 0.10;

  const opponentSwingMiss =
    opponentCtx.hitters
      ? scale(opponentCtx.avgStrikeOuts, 25, 115)
      : 50;

  const workloadPenalty =
    pitcher.inningsPitched < 20 ? 12 :
    pitcher.inningsPitched < 40 ? 6 :
    0;

  return Math.round(
    pitcherStrength * 0.74 +
    opponentSwingMiss * 0.26 -
    workloadPenalty
  );
}

function edge(score) {
  if (score >= 84) return "Elite";
  if (score >= 76) return "Strong";
  if (score >= 68) return "Value";
  if (score >= 60) return "Watch";
  return "Thin";
}

async function main() {
  if (!fs.existsSync(GAMES_FILE)) throw new Error("Missing game pitcher matchups");

  const gameData = readJson(GAMES_FILE);
  const games = rows(gameData);

  const pitcherRows = games.flatMap(game => [
    { game, ...pitcherFrom(game, "away") },
    { game, ...pitcherFrom(game, "home") }
  ]);

  const seen = new Set();
  const output = [];

  for (const row of pitcherRows) {
    if (!row.pitcherId || !row.pitcher || row.pitcher === "TBD") continue;

    const key = String(row.pitcherId);
    if (seen.has(key)) continue;
    seen.add(key);

    console.log(`Scoring ${row.pitcher}`);

    const pitcher = await getPitcherStats(row.pitcherId);
    const opponent = opponentKContext(row.game, row.side);
    const score = buildScore(pitcher, opponent);

    output.push({
      rank: 0,
      player: row.pitcher,
      playerId: row.pitcherId,
      pitcher: row.pitcher,
      pitcherId: row.pitcherId,
      team: row.team,
      opponent: row.opponent,
      game: row.game,
      score,
      odds: "N/A",
      edge: edge(score),
      note: `K/9 ${pitcher?.kPer9 || "--"} • K Rate ${pitcher?.kRate || "--"} • SO ${pitcher?.strikeOuts || 0}`,
      stats: {
        pitcher,
        opponent
      }
    });
  }

  output.sort((a, b) => b.score - a.score);

  const finalRows = output.slice(0, 40).map((row, index) => ({
    ...row,
    rank: index + 1
  }));

  fs.writeFileSync(OUT_FILE, JSON.stringify(finalRows, null, 2));

  console.log("Pitcher strikeouts board saved");
  console.log("Players:", finalRows.length);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
