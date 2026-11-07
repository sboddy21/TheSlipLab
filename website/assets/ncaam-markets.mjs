import { decimal, fresh } from './odds-core.mjs';

const signed = n => n > 0 ? `+${n}` : String(n);
const validProbability = p => Number.isFinite(p) && p >= .5 && p <= 1;
const models = { moneyline: 'Moneyline', spread: 'Spread', total: 'Over / Under' };

export function currentNcaamQuotes(game, now = Date.now()) {
  if (game.state !== 'pre' || !(Date.parse(game.kickoff) > now)) return [];
  return (game.quotes || []).filter(q => fresh(q.quotedAt, now) && Date.parse(q.quotedAt) < Date.parse(game.kickoff) && typeof q.book === 'string' && q.book && decimal(q.price));
}

function bestPrice(quotes, side) {
  return quotes.filter(q => q.side === side).sort((a,b) => decimal(b.price)-decimal(a.price)
    || Date.parse(b.quotedAt)-Date.parse(a.quotedAt) || a.book.localeCompare(b.book))[0] || null;
}

export function ncaamReferenceLine(quotes, market) {
  const byLine = new Map(), sides = market === 'spread' ? ['home','away'] : ['over','under'];
  for (const q of quotes) {
    if (q.market !== market || !sides.includes(q.side) || !Number.isFinite(q.line) || !q.book
      || !Number.isInteger(q.line * 2) || (market === 'total' && q.line <= 0)) continue;
    const line = market === 'spread' && q.side === 'away' ? -q.line : q.line;
    const group = byLine.get(line) || [];
    group.push(q);
    byLine.set(line,group);
  }
  const candidates = [...byLine].map(([line,rows]) => ({
    line, rows, books: new Set(rows.map(q => q.book.toLowerCase())).size
  })).filter(({rows}) => sides.every(side => rows.some(q => q.side === side)));
  if (!candidates.length) return null;
  const lines = candidates.flatMap(row => Array(row.books).fill(row.line)).sort((a,b) => a-b);
  const median = (lines[Math.floor((lines.length-1)/2)] + lines[Math.floor(lines.length/2)]) / 2;
  return candidates.sort((a,b) => b.books-a.books || Math.abs(a.line-median)-Math.abs(b.line-median) || a.line-b.line)[0];
}

// Normal CDF; continuity correction leaves a separate push probability at integer lines.
function cdf(z) {
  const x = Math.abs(z), t = 1/(1 + .2316419*x);
  const tail = .3989422804014327*Math.exp(-x*x/2)*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return z < 0 ? tail : 1-tail;
}

export function lineProbabilities(line, projection) {
  const below = cdf((Math.ceil(line)-.5-projection.mean)/projection.sd);
  const above = cdf((projection.mean-Math.floor(line)-.5)/projection.sd);
  return { below, above, push: Number.isInteger(line) ? Math.max(0,1-below-above) : 0 };
}

function unavailable(market, why, projection = null) {
  return { market, label: models[market], selection: 'No pick', probability: null, why, quote: null, projection };
}

export function ncaamMarketReads(game, now = Date.now()) {
  const quotes = currentNcaamQuotes(game,now);
  const pick = game.state === 'pre' && Date.parse(game.kickoff) > now ? game.prediction : null;
  const moneyline = (pick?.hasTeamHistory ?? pick?.eligible) && game[pick.side]?.name && validProbability(pick.probability)
    ? { market:'moneyline', label:models.moneyline, selection:game[pick.side].name, probability:pick.probability,
        lean:!pick.eligible, quote:bestPrice(quotes.filter(q => q.market === 'moneyline'),pick.side),
        why:`Elo rates ${game.away.shortName || game.away.name} at ${Math.round(pick.awayRating)} and ${game.home.shortName || game.home.name} at ${Math.round(pick.homeRating)}. ${game.neutral ? 'Neutral court: no home boost.' : `The model gives ${game.home.shortName || game.home.name} a home-court boost.`}` }
    : unavailable('moneyline','No current Elo forecast with enough team history.');

  const scoreRead = market => {
    const key = market === 'spread' ? 'margin' : 'total';
    const score = pick?.score?.[key];
    if (!Number.isFinite(score?.mean) || !Number.isFinite(score?.sd) || score.sd <= 0) {
      return unavailable(market,'No current score projection with enough team history.');
    }
    const reference = ncaamReferenceLine(quotes,market);
    const home = game.home.shortName || game.home.name, away = game.away.shortName || game.away.name;
    const projected = market === 'total' ? `Projected total: ${score.mean.toFixed(1)} points.`
      : `Projected margin: ${score.mean < 0 ? away : home} by ${Math.abs(score.mean).toFixed(1)}.`;
    if (!reference) return unavailable(market,`${projected} No fresh two-sided sportsbook line to grade.`,score.mean);
    const {line,rows} = reference;
    const threshold = market === 'spread' ? -line : line;
    const sportsbook = market === 'spread' ? `${home} ${signed(line)}` : String(line);
    if (Math.abs(score.mean-threshold) > 2*score.sd) {
      return unavailable(market,`${projected} The sportsbook line (${sportsbook}) is unusually far from the projection, so the model passes.`,score.mean);
    }
    const p = lineProbabilities(threshold,score);
    if (Math.abs(p.above-p.below) < .000001) {
      return unavailable(market,`${projected} The model sees no lean at ${sportsbook}.`,score.mean);
    }
    const upper = p.above > p.below;
    const side = market === 'spread' ? (upper ? 'home' : 'away') : (upper ? 'over' : 'under');
    const sideLine = side === 'away' ? -line : line;
    const selection = market === 'spread' ? `${game[side].shortName || game[side].name} ${signed(sideLine)}`
      : `${upper ? 'Over' : 'Under'} ${line}`;
    const why = market === 'spread'
      ? `${projected} That compares with the sportsbook spread of ${home} ${signed(line)}.`
      : `Both teams’ past scoring and points allowed project ${score.mean.toFixed(1)} combined points, ${upper ? 'above' : 'below'} the ${line} line.`;
    return { market, label:models[market], selection, line:sideLine, probability:upper ? p.above : p.below,
      push:p.push, projection:score.mean, lean:(upper ? p.above : p.below) < .55, why, quote:bestPrice(rows,side) };
  };
  return [moneyline,scoreRead('spread'),scoreRead('total')];
}
