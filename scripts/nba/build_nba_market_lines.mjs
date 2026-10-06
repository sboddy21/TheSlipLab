import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "website/data");
const MARKET_MAP = {
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
  player_threes: "threes"
};

const read = name => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), "utf8"));
const norm = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

function teamNames(team = {}) {
  return [team.abbreviation, team.team, team.city, `${team.city || ""} ${team.team || ""}`.trim()].map(norm).filter(Boolean);
}

function teamMatches(team, value) {
  const target = norm(value);
  return teamNames(team).some(name => name === target);
}

function eventForGame(game, quotes) {
  const events = [...new Map(quotes.map(quote => [String(quote.providerEventId), quote])).values()];
  return events.filter(event => {
    const timeDifference = Math.abs(Date.parse(event.kickoff) - Date.parse(game.gameTimeUTC));
    return timeDifference <= 5 * 60_000 && teamMatches(game.homeTeam, event.home) && teamMatches(game.awayTeam, event.away);
  });
}

export function buildMarketLines(gamesPayload, playerPayload, oddsPayload, now = Date.now()) {
  const output = {
    sport: "NBA",
    version: "1.0",
    date: gamesPayload.date || "",
    source: "PropLine quotes from odds_nba.json",
    fetchedAt: new Date(now).toISOString(),
    authorizedSources: [],
    lines: [],
    rejections: [],
    status: "unavailable",
    timestampMeaning: "Provider observation time, not necessarily bookmaker publication time"
  };
  const games = (gamesPayload.games || []).filter(game => Number(game.gameStatus) === 1 && Date.parse(game.gameTimeUTC) > now);
  const quotes = (oddsPayload.quotes || []).filter(quote => quote.provider === "PropLine" && quote.player && MARKET_MAP[quote.market]);
  if (!games.length) {
    output.status = "no_current_pregame_games";
    return output;
  }
  if (!quotes.length) {
    output.status = "no_matching_props";
    return output;
  }

  for (const game of games) {
    const events = eventForGame(game, quotes);
    if (events.length !== 1) {
      output.rejections.push({ gameId: game.gameId, reason: "event_identity_not_unique", matches: events.length });
      continue;
    }
    const eventId = String(events[0].providerEventId);
    const eventQuotes = quotes.filter(quote => String(quote.providerEventId) === eventId);
    const groups = new Map();
    for (const quote of eventQuotes) {
      const key = [quote.bookKey, quote.market, norm(quote.player), quote.line, quote.quotedAt].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(quote);
    }
    for (const group of groups.values()) {
      const over = group.find(quote => quote.side === "over");
      const under = group.find(quote => quote.side === "under");
      if (!over || !under || ![over.price, under.price].every(price => Number.isFinite(Number(price)) && Math.abs(Number(price)) >= 100)) {
        output.rejections.push({ gameId: game.gameId, player: group[0]?.player || "", reason: "paired_prices_required" });
        continue;
      }
      const age = now - Date.parse(over.quotedAt);
      if (!Number.isFinite(age) || age < 0 || age > 20 * 60_000) {
        output.rejections.push({ gameId: game.gameId, player: over.player, reason: "stale_line" });
        continue;
      }
      const matches = (playerPayload.players || []).filter(player =>
        String(player.gameId) === String(game.gameId) && norm(player.player) === norm(over.player)
      );
      if (matches.length !== 1) {
        output.rejections.push({ gameId: game.gameId, player: over.player, reason: "player_identity_not_unique", matches: matches.length });
        continue;
      }
      const source = `PropLine:${over.bookKey}`;
      output.authorizedSources.push(source);
      output.lines.push({
        gameId: game.gameId,
        playerId: matches[0].playerId,
        player: matches[0].player,
        team: matches[0].teamAbbr,
        market: MARKET_MAP[over.market],
        providerMarket: over.market,
        line: Number(over.line),
        overOdds: Number(over.price),
        underOdds: Number(under.price),
        overDecimalOdds: Number(over.decimalOdds),
        underDecimalOdds: Number(under.decimalOdds),
        book: over.book,
        bookKey: over.bookKey,
        source,
        fetchedAt: over.quotedAt,
        providerEventId: eventId
      });
    }
  }
  output.authorizedSources = [...new Set(output.authorizedSources)];
  output.status = output.lines.length ? "available" : "no_matching_props";
  return output;
}

function main() {
  const output = buildMarketLines(read("nba_games_today"), read("nba_player_pool"), read("odds_nba"));
  fs.writeFileSync(path.join(DATA, "nba_market_lines.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`NBA PROP LINES: ${output.status}; ${output.lines.length} paired prices`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
