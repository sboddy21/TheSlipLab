import { catalogPropEvents } from '../odds/catalog-to-props.mjs';
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { proplineSettings, proplineRequest, normalizePropLineBooks } from "../providers/propline.mjs";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const API_ROOT = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "baseball_mlb";
const MARKET_KEY = "batter_home_runs";
const MAX_QUOTE_AGE_MS = Number(process.env.ODDS_MAX_QUOTE_AGE_MINUTES || 15) * 60 * 1000;
const REQUEST_SPACING_MS = Number(process.env.ODDS_REQUEST_SPACING_MS || 500);
const RATE_LIMIT_RETRY_DELAYS_MS = [2500, 5000];

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
}

function write(payload) {
  const target = path.join(DATA, "mlb_market_odds.json");
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2));
  fs.renameSync(temp, target);
}

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTeam(value) {
  const team = normalize(value);
  const aliases = new Map([
    ["oakland athletics", "athletics"],
    ["athletics", "athletics"],
    ["la angels", "los angeles angels"],
    ["los angeles angels of anaheim", "los angeles angels"],
    ["arizona d backs", "arizona diamondbacks"]
  ]);
  return aliases.get(team) || team;
}

function round(value, places = 4) {
  return Number(Number(value).toFixed(places));
}

function americanToDecimal(odds) {
  const value = Number(odds);
  if (!Number.isFinite(value) || Math.abs(value) < 100) return null;
  return value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
}

function baseEnvelope(date, availability, reasonCode, detail = null) {
  return {
    schemaVersion: "1.0",
    source: "The Odds API",
    sport: "MLB",
    providerSportKey: SPORT_KEY,
    market: MARKET_KEY,
    date,
    generatedAt: new Date().toISOString(),
    availability,
    reasonCode,
    detail,
    coverage: { slateGames: 0, matchedEvents: 0, quotedPlayers: 0, rejectedQuotes: 0 },
    policy: {
      maxQuoteAgeMinutes: MAX_QUOTE_AGE_MS / 60000,
      staleQuotesRetained: false,
      unmatchedPlayersRetained: false,
      oddsFormat: "american",
      region: "us"
    },
    events: [],
    prices: [],
    rejections: [],
    quota: null
  };
}

function captureQuota(headers) {
  const names = {
    requestsRemaining: "x-requests-remaining",
    requestsUsed: "x-requests-used",
    requestsLast: "x-requests-last"
  };
  const result = {};
  for (const [key, header] of Object.entries(names)) {
    const value = headers.get(header);
    if (value !== null && Number.isFinite(Number(value))) result[key] = Number(value);
  }
  return Object.keys(result).length ? result : null;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function getJson(url) {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "the-slip-lab-market-odds" },
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();

    if (response.ok) {
      return { data: JSON.parse(text), quota: captureQuota(response.headers) };
    }

    const retryDelay = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
    if (response.status === 429 && retryDelay) {
      console.warn(`The Odds API rate-limited a request; retrying in ${retryDelay / 1000}s`);
      await sleep(retryDelay);
      continue;
    }

    throw new Error(`The Odds API returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  throw new Error("The Odds API request exhausted its rate-limit retries");
}

function currentGames(payload) {
  return Array.isArray(payload?.games) ? payload.games.filter(g=>Date.parse(g.gameDate)>Date.now()) : [];
}

function rows(payload, key) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

function matchProviderEvents(games, providerEvents) {
  const unused = new Set(providerEvents.map(event => event.id));
  const matches = [];
  const rejected = [];

  for (const game of games) {
    const candidates = providerEvents
      .filter(event => unused.has(event.id))
      .filter(event => normalizeTeam(event.home_team) === normalizeTeam(game.homeTeam))
      .filter(event => normalizeTeam(event.away_team) === normalizeTeam(game.awayTeam))
      .map(event => ({
        event,
        distance: Math.abs(Date.parse(event.commence_time) - Date.parse(game.gameDate))
      }))
      .filter(row => Number.isFinite(row.distance) && row.distance <= 30 * 60 * 1000)
      .sort((a, b) => a.distance - b.distance);

    if (!candidates.length) {
      rejected.push({ gamePk: game.gamePk, reasonCode: "provider_event_not_found" });
      continue;
    }

    const selected = candidates[0].event;
    unused.delete(selected.id);
    matches.push({ game, providerEvent: selected });
  }

  return { matches, rejected };
}

function playerIndex(pool) {
  const index = new Map();
  for (const player of pool) {
    const key = `${player.gamePk}|${normalize(player.player)}`;
    const list = index.get(key) || [];
    list.push(player);
    index.set(key, list);
  }
  return index;
}

function probabilityIndex(tracking) {
  const index = new Map();
  for (const row of tracking) {
    const key = `${normalize(row.player)}|${normalizeTeam(row.team)}`;
    const list = index.get(key) || [];
    list.push(row);
    index.set(key, list);
  }
  return index;
}

export function quoteSides(bookmakers, now) {
  const byBook = [];
  for (const bookmaker of bookmakers || []) {
    for (const market of (bookmaker.markets || []).filter(item => item.key === MARKET_KEY)) {
    const providerLastUpdate = market.last_update || bookmaker.last_update;
    const updatedAt = Date.parse(providerLastUpdate);
    if (!Number.isFinite(updatedAt) || now - updatedAt > MAX_QUOTE_AGE_MS || updatedAt > now + 60000) continue;

    const grouped = new Map();
    for (const outcome of market.outcomes || []) {
      const playerName = String(outcome.description || "").trim();
      if (!playerName) continue;
      // This model predicts at least one HR, never two or three HRs.
      if (outcome.point === null || outcome.point === undefined || outcome.point === "" || Number(outcome.point) !== 0.5) continue;
      const key = normalize(playerName);
      const current = grouped.get(key) || { playerName };
      const side = normalize(outcome.name);
      if (side === "over" || side === "yes") current.over = outcome;
      if (side === "under" || side === "no") current.under = outcome;
      grouped.set(key, current);
    }

    for (const group of grouped.values()) {
      if (!group.over) continue;
      const overDecimal = americanToDecimal(group.over.price);
      const underDecimal = group.under ? americanToDecimal(group.under.price) : null;
      if (!overDecimal) continue;
      const overImplied = 1 / overDecimal;
      const underImplied = underDecimal ? 1 / underDecimal : null;
      const noVig = underImplied ? overImplied / (overImplied + underImplied) : null;
      byBook.push({
        bookmakerKey: bookmaker.key,
        bookmakerTitle: bookmaker.title,
        providerLastUpdate,
        playerName: group.playerName,
        overPriceAmerican: Number(group.over.price),
        underPriceAmerican: underDecimal ? Number(group.under.price) : null,
        point: Number.isFinite(Number(group.over.point)) ? Number(group.over.point) : 0.5,
        impliedProbability: overImplied,
        noVigProbability: noVig,
        decimalOdds: overDecimal
      });
    }
  }
  }
  const unique = new Map();
  for (const quote of byBook) {
    const key = `${quote.bookmakerKey}|${normalize(quote.playerName)}`;
    if (!unique.has(key) || Date.parse(quote.providerLastUpdate) > Date.parse(unique.get(key).providerLastUpdate)) unique.set(key, quote);
  }
  return [...unique.values()];
}

async function main() {
  const gamesPayload = read("mlb_games_today.json");
  const poolPayload = read("mlb_player_pool.json");
  const trackingPayload = read("hr_probability_tracking.json");
  const usePropLine = Boolean(proplineSettings().key);
  let catalog = null;
  try { catalog = read('odds_mlb.json'); } catch {}
  const catalogEvents = usePropLine && catalog ? catalogPropEvents(catalog) : null;
  const date = gamesPayload.date || todayET();
  const games = currentGames(gamesPayload);
  const envelope = baseEnvelope(date, "unavailable", "not_requested");
  envelope.coverage.slateGames = games.length;
  if(usePropLine){envelope.source="PropLine";envelope.policy.timestampMeaning="Provider observation time; not necessarily bookmaker publication time";}

  if (!games.length) {
    Object.assign(envelope, { availability: "no_games_scheduled", reasonCode: "no_games_scheduled", detail: null });
    write(envelope);
    return envelope;
  }

  const apiKey = String(process.env.ODDS_API_KEY || "").trim();
  if (!apiKey && !usePropLine) {
    Object.assign(envelope, { availability: "unavailable", reasonCode: "missing_api_key", detail: "ODDS_API_KEY is not configured" });
    write(envelope);
    return envelope;
  }

  try {
    const eventsUrl = `${API_ROOT}/sports/${SPORT_KEY}/events?apiKey=${encodeURIComponent(apiKey)}`;
    const eventResponse = catalogEvents ? {data:catalogEvents,quota:catalog.quota} : usePropLine ? await proplineRequest(`/sports/${SPORT_KEY}/events`) : await getJson(eventsUrl);
    envelope.quota = eventResponse.quota;
    const matched = matchProviderEvents(games, Array.isArray(eventResponse.data) ? eventResponse.data : []);
    envelope.rejections.push(...matched.rejected);
    envelope.coverage.matchedEvents = matched.matches.length;

    const pool = rows(poolPayload, "players");
    const tracking = rows(trackingPayload, "players");
    const players = playerIndex(pool);
    const probabilities = probabilityIndex(tracking);
    const bookmakers = String(process.env.ODDS_BOOKMAKERS || "").trim();
    for (const match of matched.matches) {
      await sleep(REQUEST_SPACING_MS);
      const query = new URLSearchParams({
        apiKey,
        regions: "us",
        markets: MARKET_KEY,
        oddsFormat: "american"
      });
      if (bookmakers) query.set("bookmakers", bookmakers);
      const url = `${API_ROOT}/sports/${SPORT_KEY}/events/${match.providerEvent.id}/odds?${query}`;
      const response = catalogEvents ? {data:catalogEvents.find(e=>e.id===match.providerEvent.id),quota:catalog.quota} : usePropLine ? await proplineRequest(`/sports/${SPORT_KEY}/events/${encodeURIComponent(match.providerEvent.id)}/odds?markets=${MARKET_KEY}`) : await getJson(url);
      if (response.quota) envelope.quota = response.quota;
      if (String(response.data?.id) !== String(match.providerEvent.id)) {
        envelope.rejections.push({ gamePk: match.game.gamePk, providerEventId: match.providerEvent.id, reasonCode: "response_event_mismatch" });
        continue;
      }
      const quotes = quoteSides(usePropLine ? normalizePropLineBooks(response.data) : response.data?.bookmakers, Date.now());
      let accepted = 0;

      for (const quote of quotes) {
        const candidates = players.get(`${match.game.gamePk}|${normalize(quote.playerName)}`) || [];
        if (candidates.length !== 1) {
          envelope.rejections.push({
            gamePk: match.game.gamePk,
            providerEventId: match.providerEvent.id,
            player: quote.playerName,
            bookmaker: quote.bookmakerKey,
            reasonCode: candidates.length ? "ambiguous_player_match" : "player_not_on_current_slate"
          });
          continue;
        }

        const player = candidates[0];
        const modelRows = probabilities.get(`${normalize(player.player)}|${normalizeTeam(player.team)}`) || [];
        if (modelRows.length !== 1) {
          envelope.rejections.push({
            gamePk: match.game.gamePk,
            playerId: player.playerId,
            player: player.player,
            bookmaker: quote.bookmakerKey,
            reasonCode: modelRows.length ? "ambiguous_probability_match" : "probability_not_found"
          });
          continue;
        }

        const rawProbability = modelRows[0].realHrProbability;
        const modelProbability = Number(rawProbability) / 100;
        if (rawProbability == null || rawProbability === "" || !Number.isFinite(modelProbability) || modelProbability < 0 || modelProbability > 1) continue;
        envelope.prices.push({
          quoteId: `${date}|${match.game.gamePk}|${player.playerId}|${quote.bookmakerKey}|${MARKET_KEY}`,
          date,
          gamePk: Number(match.game.gamePk),
          providerEventId: match.providerEvent.id,
          gameDate: match.game.gameDate,
          homeTeam: match.game.homeTeam,
          awayTeam: match.game.awayTeam,
          playerId: Number(player.playerId),
          player: player.player,
          team: player.team,
          opponent: player.opponent,
          bookmakerKey: quote.bookmakerKey,
          bookmakerTitle: quote.bookmakerTitle,
          market: MARKET_KEY,
          point: quote.point,
          overPriceAmerican: quote.overPriceAmerican,
          underPriceAmerican: quote.underPriceAmerican,
          providerLastUpdate: quote.providerLastUpdate,
          modelProbability: round(modelProbability),
          impliedProbability: round(quote.impliedProbability),
          noVigProbability: quote.noVigProbability === null ? null : round(quote.noVigProbability),
          rawEdge: round(modelProbability - quote.impliedProbability),
          noVigEdge: quote.noVigProbability === null ? null : round(modelProbability - quote.noVigProbability),
          expectedValue: round(modelProbability * quote.decimalOdds - 1),
          probabilityRank: Number(modelRows[0].probabilityRank)
        });
        accepted++;
      }

      envelope.events.push({
        gamePk: Number(match.game.gamePk),
        providerEventId: match.providerEvent.id,
        commenceTime: match.providerEvent.commence_time,
        homeTeam: match.game.homeTeam,
        awayTeam: match.game.awayTeam,
        quoteCount: accepted
      });
    }

    envelope.coverage.quotedPlayers = new Set(envelope.prices.map(row => row.playerId)).size;
    envelope.coverage.rejectedQuotes = envelope.rejections.length;
    envelope.prices.sort((a, b) => b.expectedValue - a.expectedValue || a.player.localeCompare(b.player));
    envelope.availability = envelope.prices.length
      ? envelope.coverage.matchedEvents === games.length ? "available" : "partial"
      : "unavailable";
    envelope.reasonCode = envelope.prices.length ? null : "no_current_verified_quotes";
    envelope.detail = null;
    write(envelope);
    return envelope;
  } catch (error) {
    Object.assign(envelope, {
      availability: "unavailable",
      reasonCode: "provider_request_failed",
      detail: error.message,
      events: [],
      prices: []
    });
    envelope.coverage.quotedPlayers = 0;
    envelope.coverage.rejectedQuotes = envelope.rejections.length;
    write(envelope);
    return envelope;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const result = await main();
console.log("MARKET ODDS COMPLETE");
console.log("Availability:", result.availability);
console.log("Matched events:", result.coverage.matchedEvents);
console.log("Verified quotes:", result.prices.length);
console.log("Saved:", path.join(DATA, "mlb_market_odds.json"));

}
