import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketLines } from "../scripts/nba/build_nba_market_lines.mjs";
import { evaluateNbaMarkets } from "../scripts/nba/build_nba_verified_markets.mjs";

const now = Date.parse("2026-10-20T20:00:00Z");
const kickoff = "2026-10-20T23:00:00Z";
const quotedAt = new Date(now - 60_000).toISOString();
const games = { date: "2026-10-20", games: [{ gameId: "g1", gameStatus: 1, gameTimeUTC: kickoff, homeTeam: { city: "Boston", team: "Celtics", abbreviation: "BOS" }, awayTeam: { city: "Detroit", team: "Pistons", abbreviation: "DET" } }] };
const players = { players: [{ gameId: "g1", playerId: "p1", player: "Test Player", teamAbbr: "BOS" }] };
const quote = side => ({ provider: "PropLine", providerEventId: "e1", quoteId: side, market: "player_points", side, line: 20.5, decimalOdds: 1.91, price: -110, book: "DraftKings", bookKey: "draftkings", quotedAt, kickoff, home: "Boston Celtics", away: "Detroit Pistons", player: "Test Player" });

test("NBA market lines require exact event identity and paired prices", () => {
  const result = buildMarketLines(games, players, { quotes: [quote("over"), quote("under")] }, now);
  assert.equal(result.status, "available");
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].playerId, "p1");
  assert.equal(result.lines[0].overOdds, -110);

  const missingUnder = buildMarketLines(games, players, { quotes: [quote("over")] }, now);
  assert.equal(missingUnder.lines.length, 0);
  assert.ok(missingUnder.rejections.some(row => row.reason === "paired_prices_required"));
});

test("priced NBA comparisons stay locked until the strategy is validated", () => {
  const marketLines = buildMarketLines(games, players, { quotes: [quote("over"), quote("under")] }, now);
  const row = { gameId: "g1", playerId: "p1", player: "Test Player", team: "BOS", opponent: "DET", gameTimeUTC: kickoff, publicationEligible: true, pointsLean: 24.2 };
  const empty = { date: games.date, players: [] };
  const result = evaluateNbaMarkets({ points: { date: games.date, players: [row] }, rebounds: empty, assists: empty, threes: empty, lines: marketLines }, now);
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].difference, 3.7);
  assert.equal(result.locked, true);
  assert.equal(result.recommendations.length, 0);
  assert.match(result.blockers[0], /out-of-sample/i);
});

test("unconfirmed players cannot create priced comparisons", () => {
  const marketLines = buildMarketLines(games, players, { quotes: [quote("over"), quote("under")] }, now);
  const row = { gameId: "g1", playerId: "p1", player: "Test Player", gameTimeUTC: kickoff, publicationEligible: false, pointsLean: 24.2 };
  const empty = { date: games.date, players: [] };
  const result = evaluateNbaMarkets({ points: { date: games.date, players: [row] }, rebounds: empty, assists: empty, threes: empty, lines: marketLines }, now);
  assert.equal(result.comparisons.length, 0);
  assert.ok(result.rejectedLines[0].reasons.includes("availability_or_role_unconfirmed"));
});
