import { DAILY_MODEL, dayCutoff, fitRatings, predictRatings } from './ratings.mjs';
// Normalization, versioned models, and immutable-pick grading.
export const number = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export const MODEL = DAILY_MODEL;
export function normalize(event) {
  const c = event.competitions?.[0];
  if (!c) return null;
  const team = side => {
    const row = c.competitors?.find(t => t.homeAway === side);
    if (!row?.team?.id) return null;
    return { id: String(row.team.id), name: row.team.displayName, location: row.team.location || row.team.shortDisplayName, short: row.team.abbreviation,
      conference: String(row.team.conferenceId || ''), rank: row.curatedRank?.current <= 25 ? row.curatedRank.current : null,
      record: row.records?.find(r => r.type === 'total')?.summary || '—', score: number(row.score) };
  };
  const home = team('home'), away = team('away');
  if (!home || !away) return null;
  const o = c.odds?.[0], state = event.status?.type || {};
  // Explicit side lines avoid assuming that ESPN's legacy spread belongs to the home team.
  const rawHomeSpread=number(o?.pointSpread?.home?.close?.line),rawAwaySpread=number(o?.pointSpread?.away?.close?.line);
  const homeSpread=rawHomeSpread!==null&&rawAwaySpread!==null&&Math.abs(rawHomeSpread+rawAwaySpread)<0.001?rawHomeSpread:null;
  return { id: String(event.id), date: event.date, timeValid: c.timeValid !== false, home, away,
    state: state.state || 'unknown', statusName:state.name || null, completed: state.completed === true, canceled: state.name === 'STATUS_CANCELED', status: state.shortDetail || state.description || 'Status unavailable',
    neutral: c.neutralSite === true, venue: c.venue?.fullName || 'Venue TBD',
    broadcast: c.broadcasts?.flatMap(b => b.names || []).join(' / ') || '',
    weather: event.weather ? `${event.weather.displayValue || ''} ${event.weather.temperature ?? '—'}°F`.trim() : '',
    market: o ? { provider: o.provider?.name || 'ESPN odds', homeSpread,
      total: number(o.overUnder), homeML: number(o.moneyline?.home?.close?.odds), awayML: number(o.moneyline?.away?.close?.odds),
      homePrice: number(o.pointSpread?.home?.close?.odds), awayPrice: number(o.pointSpread?.away?.close?.odds),
      overPrice: number(o.total?.over?.close?.odds), underPrice: number(o.total?.under?.close?.odds) } : null };
}
export function project(game, history, now = Date.now(), config = {}) {
  return predictRatings(game,fitRatings(history,Math.min(dayCutoff(now),dayCutoff(game.date)),{...config,cadence:"daily"}));
}
export function baselineProject(game, history, now = Date.now()) {
  const cutoff = Math.min(now, Date.parse(game.date));
  const baseline = id => {
    const rows = history.filter(g => g.id !== game.id && g.completed && Date.parse(g.date) < cutoff &&
      cutoff - Date.parse(g.date) < 370 * 86400000 && (g.home.id === id || g.away.id === id) && g.home.score !== null && g.away.score !== null)
      .sort((a,b) => Date.parse(b.date) - Date.parse(a.date)).slice(0,8);
    if (rows.length < 4) return null;
    const scores = rows.map(g => g.home.id === id ? [g.home.score,g.away.score] : [g.away.score,g.home.score]);
    // Three league-neutral prior games temper small samples. No calibrated win probabilities.
    return { games: rows.length, pointsFor: (scores.reduce((s,r) => s+r[0],0)+84)/(rows.length+3),
      pointsAgainst: (scores.reduce((s,r) => s+r[1],0)+84)/(rows.length+3), lastGame: rows[0].date };
  };
  const home = baseline(game.home.id), away = baseline(game.away.id);
  if (!home || !away) return null;
  const homeScore = (home.pointsFor + away.pointsAgainst)/2 + (game.neutral ? 0 : 1.25);
  const awayScore = (away.pointsFor + home.pointsAgainst)/2 - (game.neutral ? 0 : 1.25);
  return { model: 'scoring-baseline-v1', homeScore, awayScore, margin: homeScore-awayScore, total: homeScore+awayScore, home, away };
}
export { candidates } from '../../website/assets/cfb-market.mjs';
export function grade(pick, game) {
  if (game?.canceled) return { result: 'void', units: 0 };
  if (!game?.completed || game.home.score === null || game.away.score === null) return { result: 'pending', units: null };
  const delta = pick.market === 'spread' ? (pick.side === 'home' ? game.home.score-game.away.score : game.away.score-game.home.score)+pick.line :
    (game.home.score+game.away.score-pick.line)*(pick.side === 'over' ? 1 : -1);
  const result = delta === 0 ? 'push' : delta > 0 ? 'win' : 'loss';
  return { result, units: result === 'push' ? 0 : result === 'loss' ? -1 : Number.isFinite(pick.decimalOdds) && pick.decimalOdds > 1 ? pick.decimalOdds-1 : pick.price > 0 ? pick.price/100 : 100/-pick.price };
}
