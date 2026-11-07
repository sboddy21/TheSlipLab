import assert from 'node:assert/strict';
import test from 'node:test';
import { ncaamMarketReads, lineProbabilities } from '../website/assets/ncaam-markets.mjs';

const now = Date.parse('2026-11-07T17:00:00Z');
function fixture() {
  const quotedAt = new Date(now - 60_000).toISOString();
  const quote = (market, side, line, book, price = -110) => ({ market, side, line, book, price, quotedAt });
  return {
    state:'pre', kickoff:new Date(now + 3_600_000).toISOString(),
    home:{name:'Home'}, away:{name:'Away'}, neutral:false,
    prediction:{side:'home', probability:.72, hasTeamHistory:true, eligible:true, homeRating:1600, awayRating:1500,
      score:{margin:{mean:7,sd:10},total:{mean:153,sd:15}}},
    quotes:[
      quote('moneyline','home',null,'Book A',-190),
      quote('spread','home',-9.5,'Book A'),quote('spread','away',9.5,'Book A',-105),
      quote('spread','home',-9.5,'Book B'),quote('spread','away',9.5,'Book B',-115),
      quote('spread','home',-20.5,'Book C'),quote('spread','away',20.5,'Book C',120),
      quote('total','over',150,'Book A'),quote('total','under',150,'Book A')
    ]
  };
}

test('winner, cover, and total are independent reads; alternate lines cannot overwrite the reference line', () => {
  const [ml,spread,total] = ncaamMarketReads(fixture(),now);
  assert.equal(ml.selection,'Home');
  assert.equal(ml.probability,.72);
  assert.equal(spread.selection,'Away +9.5');
  assert.equal(spread.quote.price,-105);
  assert.ok(spread.probability > .59 && spread.probability < .61);
  assert.equal(total.selection,'Over 150');
  assert.ok(total.probability > .56 && total.probability < .57);
  assert.ok(total.push > 0);
});

test('old prices and insufficient history stay unavailable; no pregame pick survives tipoff', () => {
  const game = fixture();
  const [ml,spread,total] = ncaamMarketReads(game,now + 21 * 60_000);
  assert.equal(ml.quote,null);
  assert.equal(spread.probability,null);
  assert.equal(total.probability,null);
  assert.equal(total.projection,153);
  assert.ok(ncaamMarketReads(game,Date.parse(game.kickoff)).every(r=>r.probability===null));
  delete game.prediction;
  assert.ok(ncaamMarketReads(game,now).every(r=>r.probability===null));
});

test('integer lines count pushes separately and half points have no push', () => {
  const projection = { mean: 150, sd: 15 };
  const p = lineProbabilities(150,projection);
  assert.equal(p.above,p.below);
  assert.ok(p.push > 0);
  assert.ok(Math.abs(p.above + p.below + p.push - 1) < 1e-12);
  const half = lineProbabilities(150.5,projection);
  assert.equal(half.push,0);
  assert.ok(Math.abs(half.above + half.below - 1) < 1e-12);
});

test('an extreme projection-to-line disagreement does not surface as a high-confidence pick', () => {
  const game = fixture();
  game.prediction.score.margin.mean = -30;
  const [,spread] = ncaamMarketReads(game,now);
  assert.equal(spread.probability,null);
  assert.match(spread.why,/unusually far/);
});
