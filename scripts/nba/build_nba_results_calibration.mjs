import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../website/data");
const MARKETS = ["points", "rebounds", "assists", "threes"];
const TARGET_MAE = { points: 5.5, rebounds: 2.5, assists: 2.0, threes: 1.1 };
const MINIMUM_SAMPLES = 150;

const read = name => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), "utf8"));
const readOr = (name, fallback) => {
  const file = path.join(DATA, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
};
const round = value => Math.round(Number(value) * 10) / 10;
const finite = value => Number.isFinite(Number(value));

function projectionRows(payloads) {
  const maps = Object.fromEntries(MARKETS.map(market => [market, new Map((payloads[market]?.players || []).map(row => [String(row.playerId), row]))]));
  return (payloads.points?.players || []).filter(player => player.publicationEligible).map(player => ({
    gameId: player.gameId,
    gameTimeUTC: player.gameTimeUTC,
    playerId: player.playerId,
    player: player.player,
    team: player.team,
    opponent: player.opponent,
    expectedMinutes: player.expectedMinutes,
    minutesConfidence: player.minutesConfidence,
    availabilityStatus: player.availabilityStatus,
    projections: Object.fromEntries(MARKETS.map(market => [market, maps[market].get(String(player.playerId))?.[`${market}Lean`] ?? null])),
    scores: Object.fromEntries(MARKETS.map(market => [market, maps[market].get(String(player.playerId))?.[`${market}Score`] ?? null]))
  })).filter(row => MARKETS.every(market => finite(row.projections[market])));
}

export function updateTracking({ games, pool, points, rebounds, assists, threes, lines, history }, now = Date.now()) {
  const output = structuredClone(history || { sport: "NBA", version: "1.0", snapshots: [] });
  if (!Array.isArray(output.snapshots)) output.snapshots = [];
  const projections = projectionRows({ points, rebounds, assists, threes });
  const gamesById = new Map((games.games || []).map(game => [String(game.gameId), game]));
  const existing = new Set(output.snapshots.map(row => `${row.gameId}:${row.playerId}`));
  const lineRows = Array.isArray(lines.lines) ? lines.lines : [];

  for (const projection of projections) {
    const game = gamesById.get(String(projection.gameId));
    const key = `${projection.gameId}:${projection.playerId}`;
    if (existing.has(key) || !game || Number(game.gameStatus) !== 1 || Date.parse(game.gameTimeUTC) <= now) continue;
    const playerLines = lineRows.filter(line => String(line.gameId) === String(projection.gameId) && String(line.playerId) === String(projection.playerId));
    output.snapshots.push({
      ...projection,
      date: games.date,
      capturedAt: new Date(now).toISOString(),
      frozenPregame: true,
      lines: playerLines,
      status: "pending"
    });
    existing.add(key);
  }

  const poolByKey = new Map((pool.players || []).map(player => [`${player.gameId}:${player.playerId}`, player]));
  for (const snapshot of output.snapshots) {
    if (snapshot.status === "graded" || snapshot.status === "dnp") continue;
    const game = gamesById.get(String(snapshot.gameId));
    if (!game || Number(game.gameStatus) !== 3) continue;
    const player = poolByKey.get(`${snapshot.gameId}:${snapshot.playerId}`);
    if (!player || !player.played) {
      snapshot.status = "dnp";
      snapshot.settledAt = new Date(now).toISOString();
      continue;
    }
    const actual = {
      points: Number(player.boxScore?.points || 0),
      rebounds: Number(player.boxScore?.rebounds || 0),
      assists: Number(player.boxScore?.assists || 0),
      threes: Number(player.boxScore?.threesMade || 0),
      minutes: player.boxScore?.minutes || player.boxScore?.minutesCalculated || ""
    };
    snapshot.actual = actual;
    snapshot.errors = Object.fromEntries(MARKETS.map(market => [market, round(Math.abs(Number(snapshot.projections[market]) - actual[market]))]));
    snapshot.signedErrors = Object.fromEntries(MARKETS.map(market => [market, round(Number(snapshot.projections[market]) - actual[market])]));
    snapshot.status = "graded";
    snapshot.settledAt = new Date(now).toISOString();
  }

  output.snapshots.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.gameId).localeCompare(String(b.gameId)) || String(a.player).localeCompare(String(b.player)));
  output.date = games.date || "";
  output.updatedAt = new Date(now).toISOString();
  return output;
}

export function buildCalibration(history, date, now = Date.now()) {
  const graded = (history.snapshots || []).filter(row => row.status === "graded" && row.actual);
  const markets = {};
  for (const market of MARKETS) {
    const rows = graded.filter(row => finite(row.errors?.[market]) && finite(row.signedErrors?.[market]));
    const absolute = rows.map(row => Number(row.errors[market]));
    const signed = rows.map(row => Number(row.signedErrors[market]));
    const squared = signed.map(value => value * value);
    const mae = absolute.length ? absolute.reduce((sum, value) => sum + value, 0) / absolute.length : null;
    markets[market] = {
      samples: rows.length,
      mae: mae == null ? null : round(mae),
      bias: signed.length ? round(signed.reduce((sum, value) => sum + value, 0) / signed.length) : null,
      rmse: squared.length ? round(Math.sqrt(squared.reduce((sum, value) => sum + value, 0) / squared.length)) : null,
      targetMae: TARGET_MAE[market],
      minimumSamples: MINIMUM_SAMPLES,
      projectionPassing: rows.length >= MINIMUM_SAMPLES && mae <= TARGET_MAE[market],
      pricedStrategyValidated: false
    };
  }
  return {
    sport: "NBA",
    version: "1.0",
    date,
    generatedAt: new Date(now).toISOString(),
    mode: "shadow",
    minimumSamples: MINIMUM_SAMPLES,
    gradedPlayers: graded.length,
    pendingPlayers: (history.snapshots || []).filter(row => row.status === "pending").length,
    dnpPlayers: (history.snapshots || []).filter(row => row.status === "dnp").length,
    markets,
    verified: false,
    releaseStatus: Object.values(markets).every(row => row.projectionPassing) ? "projection_review_eligible" : "collecting",
    pricedStrategyStatus: "locked_unvalidated",
    notes: [
      "Metrics use frozen pregame projections only.",
      "DNP records are excluded from projection-error metrics.",
      "Projection accuracy does not validate a priced betting strategy."
    ]
  };
}

export function buildResults(history, calibration, date, now = Date.now()) {
  const graded = (history.snapshots || []).filter(row => row.status === "graded");
  const byDate = new Map();
  for (const row of graded) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }
  return {
    sport: "NBA",
    version: "1.0",
    date,
    generatedAt: new Date(now).toISOString(),
    gradedPlayers: graded.length,
    gradedSlates: byDate.size,
    marketMetrics: calibration.markets,
    slates: [...byDate.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([slateDate, rows]) => ({ date: slateDate, playerCount: rows.length, players: rows })),
    disclaimer: "Historical projection performance is descriptive and does not guarantee future results."
  };
}

function write(name, payload) {
  const target = path.join(DATA, `${name}.json`);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

function main() {
  const games = read("nba_games_today");
  const history = updateTracking({
    games,
    pool: read("nba_player_pool"),
    points: read("nba_points"),
    rebounds: read("nba_rebounds"),
    assists: read("nba_assists"),
    threes: read("nba_threes"),
    lines: read("nba_market_lines"),
    history: readOr("nba_projection_history", { sport: "NBA", version: "1.0", snapshots: [] })
  });
  const calibration = buildCalibration(history, games.date);
  const results = buildResults(history, calibration, games.date);
  write("nba_projection_history", history);
  write("nba_calibration", calibration);
  write("nba_results", results);
  console.log(`NBA RESULTS: ${calibration.gradedPlayers} graded, ${calibration.pendingPlayers} pending, ${calibration.dnpPlayers} DNP`);
  console.log(`NBA CALIBRATION: ${calibration.releaseStatus}; priced strategy ${calibration.pricedStrategyStatus}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
