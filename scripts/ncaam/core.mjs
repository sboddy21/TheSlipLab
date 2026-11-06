import { decimal, fresh, matchEvent, norm } from '../../website/assets/odds-core.mjs';
export const easternDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function normalizeGame(event) {
  const c = event.competitions?.[0];
  if (!c || c.competitors?.length !== 2) return null;
  const team = side => {
    const row = c.competitors.find(item => item.homeAway === side);
    if (!row?.team?.id) return null;
    const rank = number(row.curatedRank?.current);
    return { id: String(row.team.id), name: row.team.displayName, shortName: row.team.shortDisplayName, abbreviation: row.team.abbreviation, names: [row.team.displayName, row.team.shortDisplayName, row.team.location, row.team.abbreviation].filter(Boolean), rank: rank >= 1 && rank <= 25 ? rank : null, record: row.records?.find(r => r.type === 'total')?.summary || '—', score: number(row.score), stats: Object.fromEntries((row.statistics || []).filter(s => ['avgPoints', 'avgRebounds', 'avgAssists', 'fieldGoalPct', 'threePointFieldGoalPct'].includes(s.name)).map(s => [s.name, number(s.displayValue)])) };
  };
  const home = team('home'), away = team('away');
  if (!home || !away || !Number.isFinite(Date.parse(event.date))) return null;
  const status = event.status || c.status || {};
  return { id: String(event.id), kickoff: event.date, season: event.season?.year, home, away, state: status.type?.state || 'unknown', statusName: status.type?.name || 'UNKNOWN', completed: status.type?.completed === true && status.type?.name === 'STATUS_FINAL', status: status.type?.shortDetail || status.type?.description || 'Status unavailable', neutral: c.neutralSite === true, conferenceGame: c.conferenceCompetition === true, venue: c.venue?.fullName || 'Venue unavailable', broadcast: (c.broadcasts || []).flatMap(b => b.names || []).join(' / ') };
}
export function scoreboardQuotes(event, observedAt, now = Date.now()) {
  const game = normalizeGame(event);
  if (!game || game.state !== 'pre' || Date.parse(game.kickoff) <= now) return [];
  const quotes = [];
  for (const odds of event.competitions[0].odds || []) {
    const book = odds.provider?.displayName || odds.provider?.name;
    if (!book) continue;
    for (const market of ['moneyline', 'spread', 'total']) for (const side of market === 'total' ? ['over', 'under'] : ['home', 'away']) {
      const close = odds[market === 'spread' ? 'pointSpread' : market]?.[side]?.close;
      const price = number(close?.odds), decimalOdds = decimal(price);
      const line = market === 'moneyline' ? null : number(String(close?.line ?? '').replace(/^[ou]/i, ''));
      if (!decimalOdds || (market !== 'moneyline' && line === null) || (market === 'total' && line <= 0)) continue;
      quotes.push({ provider: 'ESPN scoreboard', providerEventId: game.id, quoteId: `${game.id}|${book}|${market}|${side}|${line}`, home: game.home.name, away: game.away.name, kickoff: game.kickoff, book, bookKey: book, market, side, line, price, decimalOdds, quotedAt: observedAt, timestampKind: 'market-observation' });
    }
  }
  return quotes;
}
export function quotesForGame(game, catalog, now = Date.now()) {
  if (game.state !== 'pre' || Date.parse(game.kickoff) <= now) return [];
  const event = matchEvent({ kickoff: game.kickoff, homeNames: game.home.names, awayNames: game.away.names }, catalog.events || []);
  if (!event) return [];
  return (catalog.quotes || []).filter(q => String(q.providerEventId) === String(event.id) && !q.player && ['moneyline', 'spread', 'total'].includes(q.market) && fresh(q.quotedAt, now) && q.decimalOdds > 1 && decimal(q.price) && (q.market === 'moneyline' || Number.isFinite(q.line)));
}
export function gradeQuote(quote, game) {
  if (!game.completed || !Number.isFinite(game.home.score) || !Number.isFinite(game.away.score)) return 'pending';
  const margin = game.home.score - game.away.score;
  let value;
  if (quote.market === 'total') value = (game.home.score + game.away.score - quote.line) * (quote.side === 'over' ? 1 : -1);
  else if (quote.market === 'spread') value = (quote.side === 'home' ? margin : -margin) + quote.line;
  else value = quote.side === 'home' ? margin : -margin;
  return value === 0 ? 'push' : value > 0 ? 'win' : 'loss';
}
export function updateArchive(previous, games, catalog, now = Date.now()) {
  const rows = new Map((previous?.games || []).map(g => [g.id, g]));
  for (const game of games) {
    const old = rows.get(game.id);
    const quotes = quotesForGame(game, catalog, now);
    const captured = quotes.length ? quotes : old?.capturedQuotes || [];
    rows.set(game.id, { ...game, capturedAt: quotes.length ? new Date(now).toISOString() : old?.capturedAt || null, capturedQuotes: captured.map(q => ({ ...q, result: gradeQuote(q, game) })) });
  }
  return { schemaVersion: 1, sport: 'NCAAM', generatedAt: new Date(now).toISOString(), description: 'Observed pregame lines, not model picks. The last successful pregame observation is retained; these are not verified closing lines.', games: [...rows.values()].sort((a,b) => b.kickoff.localeCompare(a.kickoff)) };
}

// Prefer the sportsbook observation when both sources list the same book/selection/line.
export function mergeGameQuotes(game, quotes) {
  const unique = new Map();
  for (const quote of quotes) {
    const key = [norm(quote.book), quote.market, quote.side, quote.line].join('|');
    if (!unique.has(key)) unique.set(key, { ...quote, providerEventId: game.id, home: game.home.name, away: game.away.name, quoteId: `${game.id}|${key}` });
  }
  return [...unique.values()];
}
