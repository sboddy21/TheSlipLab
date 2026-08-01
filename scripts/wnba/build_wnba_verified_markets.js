import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "website/data");
const BOARD_FILE = path.join(DATA, "wnba_projection_board.json");
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
    passing: Boolean(row?.passing && row.samples >= (calibration.minimumSamples || 150))
  };
}

function main() {
  const board = read(BOARD_FILE);
  const calibration = read(CALIBRATION_FILE);
  const linesFile = read(LINES_FILE);
  const now = Date.now();
  const authorizedSources = new Set(Array.isArray(linesFile.authorizedSources) ? linesFile.authorizedSources : []);
  const gates = [...supportedMarkets].map(market => marketGate(calibration, market));
  const gateByMarket = new Map(gates.map(gate => [gate.market, gate]));
  const projectionsByKey = new Map((board.projections || []).flatMap(player => [...supportedMarkets].map(market => [`${player.playerId}:${market}`, { player, market, projection: player.projections?.[market] }])));
  const blockers = [];
  const rejectedLines = [];
  const recommendations = [];

  if (!gates.some(gate => gate.passing)) blockers.push("No market has passed its minimum sample and MAE requirements.");
  if (!authorizedSources.size) blockers.push("No authorized WNBA player-market line feed is configured.");
  if (!Array.isArray(linesFile.lines) || !linesFile.lines.length) blockers.push("No WNBA player-market lines are available.");
  if (linesFile.date !== board.date) blockers.push("Market-line slate date does not match the frozen projection slate.");

  for (const line of linesFile.lines || []) {
    const market = String(line.market || "").toLowerCase();
    const key = `${line.playerId}:${market}`;
    const match = projectionsByKey.get(key);
    const rejection = [];
    if (!supportedMarkets.has(market)) rejection.push("unsupported_market");
    if (!gateByMarket.get(market)?.passing) rejection.push("calibration_locked");
    if (!match?.projection) rejection.push("missing_frozen_projection");
    if (!Number.isFinite(Number(line.line))) rejection.push("invalid_line");
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
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`WNBA VERIFIED MARKET GATE: ${status}; ${recommendations.length} recommendation(s); ${rejectedLines.length} rejected line(s)`);
  blockers.forEach(blocker => console.log(`- ${blocker}`));
}

try { main(); } catch (error) { console.error("WNBA VERIFIED MARKET GATE FAILED"); console.error(error); process.exit(1); }
