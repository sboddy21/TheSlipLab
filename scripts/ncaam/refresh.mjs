import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { refreshSport } from '../odds/refresh.mjs';
import { easternDate, normalizeGame, scoreboardQuotes, updateArchive, mergeGameQuotes } from './core.mjs';
import { modelForSlate, archivePicks } from './live-model.mjs';
const directory = new URL('../../website/data/', import.meta.url);
async function read(name, fallback) { try { return JSON.parse(await fs.readFile(new URL(name, directory), 'utf8')); } catch { return fallback; } }
async function write(name, data) { const target = new URL(name, directory); await fs.writeFile(new URL(target.href + '.tmp'), JSON.stringify(data, null, 2) + '\n'); await fs.rename(new URL(target.href + '.tmp'), target); }
import { fetchScoreboard } from './scoreboard.mjs';
export async function refresh(date = easternDate()) {
  const now = Date.now(), generatedAt = new Date(now).toISOString();
  const previous = await read('ncaam_results.json', { games: [] });
  const events = await fetchScoreboard(date); // Never replace a valid board on source failure.
  const games = events.map(normalizeGame).filter(Boolean);
  const catalog = await refreshSport('NCAAM', { now, includeProps: false });
  // ESPN supplies a separately attributed fallback, without claiming bookmaker publication times.
  const fallback = events.flatMap(e => scoreboardQuotes(e, generatedAt, now));
  const fallbackIds = new Set(fallback.map(q => q.providerEventId));
  catalog.events.push(...games.filter(g => fallbackIds.has(g.id)).map(g => ({ id: g.id, home: g.home.name, away: g.away.name, kickoff: g.kickoff })));
  catalog.quotes.push(...fallback);
  // Different provider event IDs must not make an otherwise exact event match ambiguous.
  const { quotesForGame } = await import('./core.mjs');
  const joined = games.map(g => {
    const rapid = quotesForGame(g, { ...catalog, events: catalog.events.filter(e => !fallbackIds.has(e.id)), quotes: catalog.quotes.filter(q => q.provider !== 'ESPN scoreboard') }, now);
    return { ...g, quotes: mergeGameQuotes(g, [...rapid, ...fallback.filter(q => q.providerEventId === g.id)]) };
  });
  let model = { status: 'unavailable', reason: 'Model could not be verified' };
  try {
    const result = await modelForSlate(joined, date, fetchScoreboard, now);
    model = result.model;
    for (const game of joined) game.prediction = result.forecasts.get(game.id);
  } catch (error) { model.reason = error.message; }
  const canonical = { events: games.map(g => ({ id: g.id, home: g.home.name, away: g.away.name, kickoff: g.kickoff })), quotes: joined.flatMap(g => g.quotes.map(q => ({ ...q, providerEventId: g.id }))) };
  const errors = [...catalog.errors];
  const dates = [...new Set(previous.games.filter(g => !g.completed && g.kickoff < `${date}T00:00:00Z`).map(g => easternDate(new Date(g.kickoff))))].slice(0, 7);
  const historical = [];
  for (const day of dates) { try { historical.push(...(await fetchScoreboard(day)).map(normalizeGame).filter(Boolean)); } catch (error) { errors.push({ provider: 'ESPN scoreboard', message: error.message }); } }
  const archive = updateArchive(previous, [...historical, ...games], canonical, now);
  catalog.events = canonical.events; catalog.quotes = canonical.quotes;
  catalog.coverage = { events: catalog.events.length, gameQuotes: catalog.quotes.length, propQuotes: 0 };
  catalog.status = catalog.quotes.length ? 'available' : 'no_upcoming_markets';
  const board = { schemaVersion: 1, sport: 'NCAAM', date, generatedAt, status: games.length ? 'available' : 'no_games', source: 'ESPN men’s college basketball scoreboard; RapidAPI Sportsbook', modelStatus: model.status, model, games: joined, errors: [], warnings: errors };
  await fs.mkdir(directory, { recursive: true });
  const picks = archivePicks(await read('ncaam_picks.json', { picks: [] }), [...historical, ...joined], now);
  await write('ncaam_picks.json', picks);
  await write('odds_ncaam.json', catalog); await write('ncaam_results.json', archive); await write('ncaam_board.json', board);
  return { date, games: games.length, quotes: catalog.quotes.length, archivedGames: archive.games.length, errors };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const date = process.argv[2] || easternDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Expected YYYY-MM-DD');
  try { console.log(JSON.stringify(await refresh(date))); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
