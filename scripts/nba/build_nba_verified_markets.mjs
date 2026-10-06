import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../website/data");
const read = name => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), "utf8"));
const round = value => Math.round(Number(value) * 10) / 10;

export function evaluateNbaMarkets({ points, rebounds, assists, threes, lines, calibration = {} }, now = Date.now()) {
  const boards = { points, rebounds, assists, threes };
  const comparisons = [];
  const rejectedLines = [];
  const authorized = new Set(lines.authorizedSources || []);

  for (const line of lines.lines || []) {
    const board = boards[line.market];
    const player = (board?.players || []).find(row => String(row.playerId) === String(line.playerId) && String(row.gameId) === String(line.gameId));
    const projection = player?.[`${line.market}Lean`];
    const reasons = [];
    if (!player) reasons.push("missing_projection_identity");
    if (!player?.publicationEligible) reasons.push("availability_or_role_unconfirmed");
    if (!authorized.has(line.source)) reasons.push("unauthorized_source");
    if (![line.overOdds, line.underOdds].every(price => Number.isFinite(Number(price)) && Math.abs(Number(price)) >= 100)) reasons.push("invalid_prices");
    if (!Number.isFinite(Number(line.line)) || Number(line.line) < 0) reasons.push("invalid_line");
    const age = now - Date.parse(line.fetchedAt || lines.fetchedAt || "");
    if (!Number.isFinite(age) || age < 0 || age > 20 * 60_000) reasons.push("stale_line");
    if (!Number.isFinite(Number(projection))) reasons.push("invalid_projection");
    const start = Date.parse(player?.gameTimeUTC || "");
    if (!Number.isFinite(start) || start <= now) reasons.push("game_not_pregame");
    if (reasons.length) {
      rejectedLines.push({ playerId: String(line.playerId || ""), market: line.market, line: line.line ?? null, reasons });
      continue;
    }
    const difference = round(Number(projection) - Number(line.line));
    comparisons.push({
      gameId: line.gameId,
      playerId: line.playerId,
      player: player.player,
      team: player.team,
      opponent: player.opponent,
      market: line.market,
      line: Number(line.line),
      projection: Number(projection),
      difference,
      modelLean: difference > 0 ? "over" : difference < 0 ? "under" : "neutral",
      overOdds: line.overOdds,
      underOdds: line.underOdds,
      book: line.book,
      source: line.source,
      lineFetchedAt: line.fetchedAt,
      publicationStatus: "comparison_only_unvalidated_strategy"
    });
  }
  comparisons.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  return {
    sport: "NBA",
    version: "1.0",
    date: points.date || lines.date || "",
    generatedAt: new Date(now).toISOString(),
    phase: "priced_market_validation",
    status: "locked",
    locked: true,
    blockers: ["Priced out-of-sample NBA betting strategy has not been validated."],
    calibrationSummary: {
      gradedPlayers: calibration.gradedPlayers || 0,
      minimumSamples: calibration.minimumSamples || 150,
      releaseStatus: calibration.releaseStatus || "collecting",
      markets: calibration.markets || {}
    },
    lineSummary: { source: lines.source, received: lines.lines?.length || 0, acceptedComparisons: comparisons.length, rejected: rejectedLines.length },
    comparisons,
    recommendations: [],
    rejectedLines,
    disclaimer: "Market comparisons are research context, not betting recommendations. No outcome is guaranteed."
  };
}

function main() {
  const output = evaluateNbaMarkets({
    points: read("nba_points"), rebounds: read("nba_rebounds"), assists: read("nba_assists"), threes: read("nba_threes"), lines: read("nba_market_lines"), calibration: read("nba_calibration")
  });
  fs.writeFileSync(path.join(DATA, "nba_verified_markets.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`NBA VERIFIED MARKETS: ${output.status}; ${output.comparisons.length} comparison(s); 0 recommendations`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
