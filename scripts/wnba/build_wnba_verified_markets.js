import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "website/data");
const BOARD_FILE = path.join(DATA, "wnba_live_snapshot.json");
const CALIBRATION_FILE = path.join(DATA, "wnba_calibration.json");
const LINES_FILE = path.join(DATA, "wnba_market_lines.json");
const OUT = path.join(DATA, "wnba_verified_markets.json");

const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const round = value => Number(value.toFixed(1));
const supportedMarkets = new Set(["points", "rebounds", "assists", "threes"]);
const minimumEdge = { points: 2.0, rebounds: 1.2, assists: 1.0, threes: 0.6 };
const maximumLineAgeMinutes = 20;

function lineIsFresh(line, linesFile, now) {
  const timestamp = Date.parse(line.fetchedAt || linesFile.fetchedAt || "");
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= maximumLineAgeMinutes * 60_000;
}

function marketGate(calibration, market) {
  const row = calibration.markets?.[market];
  return {
    market,
    samples: row?.samples || 0,
    mae: row?.mae ?? null,
    targetMae: row?.targetMae ?? null,
    minimumSamples: calibration.minimumSamples || 150,
    projectionPassing: Boolean(row?.passing && row.samples >= (calibration.minimumSamples || 150)),
    // MAE alone cannot qualify a priced betting strategy. A probability model
    // and a separately evaluated, priced strategy are not implemented yet.
    passing: false,
    reason: "priced_out_of_sample_strategy_not_validated"
  };
}

export function evaluateMarkets(board, calibration, linesFile, now = Date.now()) {
  const authorizedSources = new Set(Array.isArray(linesFile.authorizedSources) ? linesFile.authorizedSources : []);
  const gates = [...supportedMarkets].map(market => marketGate(calibration, market));
  const gateByMarket = new Map(gates.map(gate => [gate.market, gate]));
  const projectionsByKey = new Map((board.projections || []).flatMap(player => [...supportedMarkets].map(market => [`${player.gameId}:${player.playerId}:${market}`, { player, market, projection: player.projections?.[market] }])));
  const blockers = [];
  const rejectedLines = [];
  const recommendations = [];

  if (!gates.some(gate => gate.passing)) blockers.push("No market has a validated betting strategy at recorded sportsbook prices.");
  if (!authorizedSources.size) blockers.push("No authorized WNBA player-market line feed is configured.");
  if (!Array.isArray(linesFile.lines) || !linesFile.lines.length) blockers.push("No WNBA player-market lines are available.");
  if (linesFile.date !== board.date) blockers.push("Market-line slate date does not match the live projection slate.");

  for (const line of linesFile.lines || []) {
    const market = String(line.market || "").toLowerCase();
    const key = `${line.gameId}:${line.playerId}:${market}`;
    const match = projectionsByKey.get(key);
    const rejection = [];
    if (!supportedMarkets.has(market)) rejection.push("unsupported_market");
    if (!gateByMarket.get(market)?.passing) rejection.push("calibration_locked");
    if (!match?.projection) rejection.push("missing_live_projection");
    if (!line.gameId) rejection.push("missing_game_id");
    const start = Date.parse(match?.player?.gameTimeUTC || "");
    if (!Number.isFinite(start) || start <= now) rejection.push("game_not_pregame");
    const generated = Date.parse(board.generatedAt || "");
    const inputTime = Date.parse(board.dataAsOf || "");
    if (!Number.isFinite(generated) || generated > now || now - generated > 20 * 60_000) rejection.push("stale_projection");
    if (board.stale || !Number.isFinite(inputTime) || inputTime > now || now - inputTime > 20 * 60_000) rejection.push("stale_inputs");
    if (match?.projection?.value == null || !Number.isFinite(Number(match?.projection?.value))) rejection.push("invalid_projection");
    if (line.overOdds == null || line.underOdds == null || ![line.overOdds,line.underOdds].every(v => Number.isFinite(Number(v)) && Math.abs(Number(v)) >= 100)) rejection.push("missing_or_invalid_prices");
    if (line.line == null || line.line === "" || !Number.isFinite(Number(line.line)) || Number(line.line) < 0) rejection.push("invalid_line");
    if (!line.source) rejection.push("missing_source");
    else if (!authorizedSources.has(line.source)) rejection.push("unauthorized_source");
    if (linesFile.date !== board.date) rejection.push("slate_date_mismatch");
    if (!lineIsFresh(line, linesFile, now)) rejection.push("stale_line");
    if (match?.player?.confidence < 65) rejection.push("low_confidence");
    if (match?.player?.injury) rejection.push("injury_flag");
    if (rejection.length) {
      rejectedLines.push({ playerId: String(line.playerId || ""), market, line: line.line ?? null, reasons: rejection });
      continue;
    }

    const projection = Number(match.projection.value);
    const marketLine = Number(line.line);
    const difference = round(projection - marketLine);
    const edge = Math.abs(difference);
    if (edge < minimumEdge[market]) {
      rejectedLines.push({ playerId: String(line.playerId), market, line: marketLine, reasons: ["edge_below_threshold"] });
      continue;
    }
    recommendations.push({
      gameId: match.player.gameId, playerId: match.player.playerId, player: match.player.player,
      team: match.player.team, opponent: match.player.opponent, market, side: difference > 0 ? "over" : "under",
      line: marketLine, projection, edge, confidence: match.player.confidence, source: line.source,
      lineFetchedAt: line.fetchedAt || linesFile.fetchedAt, audit: { calibrationSamples: gateByMarket.get(market).samples, calibrationMae: gateByMarket.get(market).mae, minimumEdge: minimumEdge[market] }
    });
  }

  recommendations.sort((a, b) => b.edge - a.edge || b.confidence - a.confidence);
  const unlockedMarkets = gates.filter(gate => gate.passing).map(gate => gate.market);
  const status = recommendations.length ? "eligible_recommendations" : "locked";
  const out = {
    sport: "WNBA", date: board.date, generatedAt: new Date().toISOString(), phase: "verified_market_gate",
    status, locked: status === "locked", unlockedMarkets, maximumLineAgeMinutes, minimumEdge,
    blockers: [...new Set(blockers)], gateSummary: gates, lineSummary: { source: linesFile.source, authorizedSources: [...authorizedSources], received: linesFile.lines?.length || 0, rejected: rejectedLines.length },
    recommendations, rejectedLines,
    disclaimer: "Recommendations can appear only after calibration and market-data gates pass. No outcome is guaranteed."
  };
  return out;
}

function main() {
  const out = evaluateMarkets(read(BOARD_FILE), read(CALIBRATION_FILE), read(LINES_FILE));
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`WNBA VERIFIED MARKET GATE: ${out.status}; ${out.recommendations.length} recommendation(s); ${out.rejectedLines.length} rejected line(s)`);
  out.blockers.forEach(blocker => console.log(`- ${blocker}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) try { main(); } catch (error) { console.error("WNBA VERIFIED MARKET GATE FAILED"); console.error(error); process.exit(1); }
