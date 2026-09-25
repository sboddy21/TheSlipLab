import test from 'node:test';
import assert from 'node:assert/strict';
import { boardRow,boardHighlights,sortBoard,noVigProbability } from '../website/assets/cfb-board.mjs';

const calibration={spread:{intercept:0,slope:1},total:{intercept:0,slope:1}};
const game={id:'1',date:'2026-09-26T16:00Z',home:{short:'HOME'},away:{short:'AWAY'},projection:{margin:7,total:56},market:{homeSpread:-3,total:50,homeML:-150,awayML:140}};

test('board derives model-versus-market gaps without treating the vig as probability edge',()=>{
  const row=boardRow(game,calibration);
  assert.equal(row.spreadGap,4);
  assert.equal(row.totalGap,6);
  assert.ok(row.overProbability>.5);
  assert.ok(row.marketWin.home>.5);
  assert.ok(Math.abs(row.marketWin.home+row.marketWin.away-1)<1e-10);
  assert.ok(Number.isFinite(row.winGap));
  assert.ok(row.modelWin.homeProbability>.5,'positive home margin must imply a home win probability above 50%');
});

test('missing sportsbook markets remain missing',()=>{
  const row=boardRow({...game,market:null},calibration);
  assert.equal(row.spreadGap,null);assert.equal(row.totalGap,null);assert.equal(row.marketWin,null);assert.equal(row.winGap,null);
  assert.equal(row.overProbability,null);
  assert.equal(noVigProbability(null,-110),null);
});

test('highlights and sorting use the largest absolute disagreements',()=>{
  const rows=[boardRow(game,calibration),boardRow({...game,id:'2',date:'2026-09-27T16:00Z',projection:{margin:-12,total:40}},calibration)];
  assert.equal(boardHighlights(rows).spread.game.id,'2');
  assert.deepEqual(sortBoard(rows,'kickoff','desc').map(row=>row.game.id),['2','1']);
});
