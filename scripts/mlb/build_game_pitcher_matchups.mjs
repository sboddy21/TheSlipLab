import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "website", "data");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  return data.games || data.players || data.rows || data.data || [];
}

function clean(v, fallback = "") {
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

function norm(v = "") {
  return clean(v).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function gameKey(g) {
  return norm(g.matchup || g.game || `${g.awayTeam || g.away} at ${g.homeTeam || g.home}`);
}

function scoreOf(h) {
  return Number(h.hrVolatilityScore ?? h.hrConfidence ?? h.score ?? h.powerScore ?? 0);
}

function buildLineupMap(lineup) {
  const map = new Map();
  if (!Array.isArray(lineup)) return map;

  for (const row of lineup) {
    const order = Number(row.order || row.lineupSpot || row.battingOrder || row.spot);
    const player = clean(row.player || row.name || row.fullName);
    const playerId = clean(row.playerId || row.id || row.mlbId);

    if (!Number.isFinite(order) || order <= 0) continue;

    const entry = {
      order,
      player,
      playerId,
      position: clean(row.position)
    };

    if (player) map.set(norm(player), entry);
    if (playerId) map.set(playerId, entry);
  }

  return map;
}

function findLineupEntry(hitter, lineupMap) {
  const playerId = clean(hitter.playerId || hitter.id || hitter.mlbId);
  const player = clean(hitter.player || hitter.name || hitter.fullName);

  if (playerId && lineupMap.has(playerId)) return lineupMap.get(playerId);
  if (player && lineupMap.has(norm(player))) return lineupMap.get(norm(player));

  return null;
}

function applyLineupData(hitter, lineupMap, lineupStatus) {
  const entry = findLineupEntry(hitter, lineupMap);
  const confirmed = String(lineupStatus || "").toUpperCase().includes("CONFIRMED");

  if (!entry) {
    return {
      ...hitter,
      lineupStatus,
      confirmedLineup: false,
      confirmedLineupSpot: null,
      lineupSource: "PROJECTED"
    };
  }

  return {
    ...hitter,
    lineupStatus,
    confirmedLineup: confirmed,
    confirmedLineupSpot: entry.order,
    lineupSpot: entry.order,
    battingOrder: entry.order,
    actualLineupSpot: entry.order,
    battingPosition: entry.position || hitter.battingPosition || hitter.position || "",
    lineupSource: confirmed ? "CONFIRMED" : "PARTIAL"
  };
}

const slatePayload = readJSON("mlb_games_today.json", { games: [] });
const hrPayload = readJSON("mlb_home_runs.json", []);

const slateGames = rows(slatePayload);
const hitters = rows(hrPayload);

const groupedHitters = new Map();

for (const hitter of hitters) {
  const key = norm(clean(hitter.game || hitter.matchup));
  if (!key) continue;
  if (!groupedHitters.has(key)) groupedHitters.set(key, []);
  groupedHitters.get(key).push(hitter);
}

const finalGames = [];

for (const slateGame of slateGames) {
  const key = gameKey(slateGame);
  const bats = groupedHitters.get(key) || [];

  const awayTeam = slateGame.awayTeam || slateGame.away || "";
  const homeTeam = slateGame.homeTeam || slateGame.home || "";

  const awayLineupMap = buildLineupMap(slateGame.awayBattingOrder);
  const homeLineupMap = buildLineupMap(slateGame.homeBattingOrder);

  const awayHitters = bats
    .filter(h => norm(h.team) === norm(awayTeam))
    .map(h => applyLineupData(h, awayLineupMap, slateGame.awayLineupStatus))
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  const homeHitters = bats
    .filter(h => norm(h.team) === norm(homeTeam))
    .map(h => applyLineupData(h, homeLineupMap, slateGame.homeLineupStatus))
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  finalGames.push({
    ...slateGame,
    game: slateGame.matchup || `${awayTeam} at ${homeTeam}`,
    matchup: slateGame.matchup || `${awayTeam} at ${homeTeam}`,

    awayPitcher: {
      name: clean(slateGame.awayProbablePitcher, "TBD"),
      pitcher: clean(slateGame.awayProbablePitcher, "TBD"),
      id: slateGame.awayProbablePitcherId || null,
      side: clean(slateGame.awayPitcherHand || slateGame.awayProbablePitcherHand)
    },

    homePitcher: {
      name: clean(slateGame.homeProbablePitcher, "TBD"),
      pitcher: clean(slateGame.homeProbablePitcher, "TBD"),
      id: slateGame.homeProbablePitcherId || null,
      side: clean(slateGame.homePitcherHand || slateGame.homeProbablePitcherHand)
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
        score: scoreOf(h),
        confirmedLineupSpot: h.confirmedLineupSpot || null,
        lineupSpot: h.lineupSpot || h.projectedLineupSpot || h.projectedSpot || null,
        lineupSource: h.lineupSource || "PROJECTED"
      }))
  });
}

writeJSON("game_pitcher_matchups.json", {
  updatedAt: new Date().toISOString(),
  date: slatePayload.date || "",
  count: finalGames.length,
  games: finalGames
});

console.log("");
console.log("GAME PITCHER MATCHUPS COMPLETE");
console.log("Games:", finalGames.length);
console.log("Hitters:", hitters.length);
console.log("Saved:", path.join(DATA_DIR, "game_pitcher_matchups.json"));
