import { easternDate, mergeGameQuotes, normalizeGame, scoreboardQuotes } from '../../scripts/ncaam/core.mjs';
import { fetchScoreboard } from '../../scripts/ncaam/scoreboard.mjs';
import { fresh } from '../assets/odds-core.mjs';

let cachedScoreboard;

function readScoreboard(date, now) {
  if (cachedScoreboard?.date === date && now - cachedScoreboard.at < 60_000) {
    return cachedScoreboard.promise;
  }
  const entry = {
    date,
    at: now,
    promise: fetchScoreboard(date).then(events => ({ events, observedAt: new Date().toISOString() }))
  };
  cachedScoreboard = entry;
  entry.promise.catch(() => {
    if (cachedScoreboard === entry) cachedScoreboard = undefined;
  });
  return entry.promise;
}

export async function loadNcaamLiveBoard(readPublished, { now = Date.now(), readLive = readScoreboard } = {}) {
  const date = easternDate(new Date(now));
  const [published, live] = await Promise.all([
    Promise.resolve().then(readPublished).catch(() => null),
    readLive(date, now).catch(() => null)
  ]);

  const snapshot = published?.date === date && published.sport === 'NCAAM'
    && Array.isArray(published.games) ? published : null;
  if (!live && !snapshot) throw new Error('Today’s NCAAM scoreboard is unavailable');

  if (!live) {
    return {
      ...snapshot,
      games: snapshot.games.map(game => ({
        ...game,
        quotes: (game.quotes || []).filter(quote => fresh(quote.quotedAt, now))
      }))
    };
  }

  const canPredict = snapshot?.model?.status === 'validated_winner_forecasts'
    && Date.parse(snapshot.generatedAt) <= now + 1000;
  const publishedGames = new Map(snapshot?.games.map(game => [game.id, game]));
  const games = live.events.map(event => {
    const game = normalizeGame(event);
    if (!game) return null;
    const saved = publishedGames.get(game.id);
    const matched = saved && Date.parse(game.kickoff) === Date.parse(saved.kickoff)
      && game.home.id === saved.home?.id && game.away.id === saved.away?.id;
    if (game.state !== 'pre' || Date.parse(game.kickoff) <= now) return { ...game, quotes: [] };
    const quotes = matched ? (saved.quotes || []).filter(quote => fresh(quote.quotedAt, now)) : [];
    return {
      ...game,
      quotes: mergeGameQuotes(game, [...quotes, ...scoreboardQuotes(event, live.observedAt, now)]),
      ...(matched && canPredict && saved.prediction ? { prediction: saved.prediction } : {})
    };
  }).filter(Boolean);

  const model = canPredict ? snapshot.model : { status: 'unavailable' };
  return {
    schemaVersion: 1,
    sport: 'NCAAM',
    date,
    generatedAt: live.observedAt,
    source: 'ESPN live scoreboard',
    status: games.length ? 'available' : 'no_games',
    modelStatus: model.status,
    model,
    forecastGeneratedAt: canPredict ? snapshot.generatedAt : null,
    games
  };
}
