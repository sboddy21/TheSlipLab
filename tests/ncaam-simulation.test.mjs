import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { simulateMatchup, outcomes, simulationConfig } from '../scripts/ncaam/simulation.mjs';
import { buildSimulationShadow } from '../scripts/ncaam/simulation-shadow.mjs';
import { hash } from '../scripts/ncaam/model.mjs';

const score = { version:'ncaam-score-v1', margin:{mean:10,sd:10}, total:{mean:150,sd:15} };
const residuals = [[0,0],[-14,16]];

test('the same 2,500 coherent outcomes determine all three markets, including pushes', () => {
  const a = simulateMatchup('game-1',score,residuals);
  assert.deepEqual(a, simulateMatchup('game-1',score,residuals));
  assert.equal(a.draws,2500);
  assert.equal(a.margins.get(0),undefined);
  assert.equal(a.homeWins,outcomes(a.margins,0).above);
  assert.equal(a.homeWins,outcomes(a.margins,10).push);
  assert.equal(a.homeWins,outcomes(a.totals,150).push);
  assert.equal(outcomes(a.totals,150.5).push,0);
  assert.equal([...a.totals.values()].reduce((a,b) => a+b,0),2500);
});

test('rounding ties are resolved into coherent winners', () => {
  const a = simulateMatchup('game-2',{margin:{mean:0},total:{mean:148}},[[0,0]]);
  assert.equal(outcomes(a.margins,0).push,0);
  assert.equal(a.totals.get(149),2500);
  assert.ok(a.homeWins > 1100 && a.homeWins < 1400);
});

test('shadow snapshot compares fresh lines without modifying production picks', () => {
  const now = Date.parse('2026-11-07T17:00:00Z'), quotedAt = new Date(now).toISOString();
  const kickoff = new Date(now + 60*60_000).toISOString();
  const game = { id:'123', state:'pre', kickoff, away:{name:'Away'}, home:{name:'Home'}, quotes:[
    { market:'spread', side:'home', line:-10, price:-110, book:'Book', quotedAt },
    { market:'spread', side:'away', line:10, price:-110, book:'Book', quotedAt },
    { market:'total', side:'over', line:150, price:-110, book:'Book', quotedAt },
    { market:'total', side:'under', line:150, price:-110, book:'Book', quotedAt }
  ], prediction:{ score, side:'home', probability:.72, eligible:true, homeRating:1600, awayRating:1500 } };
  const board = { sport:'NCAAM', date:'2026-11-07', generatedAt:quotedAt, games:[game],
    model:{status:'validated_winner_forecasts',scoreValidation:{passed:true}} };
  const original = structuredClone(board);
  const scoreArtifact = { datasetHash:'fixture', config:{version:score.version}, evaluation:{training:2} };
  const model = { ...simulationConfig, datasetHash:'fixture', scoreArtifactHash:hash(scoreArtifact),
    residuals, residualHash:hash(residuals) };
  const result = buildSimulationShadow(board,model,scoreArtifact,now);
  const row = result.games[0];
  assert.deepEqual(board,original);
  assert.equal(result.status,'shadow_only');
  assert.equal(row.currentReads.moneyline.probability,.72);
  assert.equal(row.spread.homeLine,-10);
  assert.equal(row.spread.push,row.moneyline.home);
  assert.equal(row.total.push,row.moneyline.home);
  assert.equal(row.spread.away+row.spread.home+row.spread.push,1);
  assert.throws(() => buildSimulationShadow(board,model,scoreArtifact,now+21*60_000),/current NCAAM board/);
  assert.throws(() => buildSimulationShadow(board,{...model,residualHash:'wrong'},scoreArtifact,now),/does not match/);
});

test('recorded holdout decision is tied to the versioned simulation and score artifacts', async () => {
  const read = async path => JSON.parse(await fs.readFile(new URL(path,import.meta.url),'utf8'));
  const [model,report,score] = await Promise.all([
    read('../scripts/ncaam/simulation-model.json'), read('../data/ncaam/simulation-validation.json'),
    read('../scripts/ncaam/score-model.json')
  ]);
  assert.equal(model.residualHash,hash(model.residuals));
  assert.equal(model.residualHash,report.residualHash);
  assert.equal(model.scoreArtifactHash,hash(score));
  assert.equal(report.holdoutGames,score.evaluation.holdout);
  assert.equal(report.holdoutGatePassed,Object.values(report.markets).every(row=>row.approximateDayClustered95[1]<=0));
});
