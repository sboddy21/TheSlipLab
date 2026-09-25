import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { americanPrice, projectGame, playerOverProbability, rankGameMarkets } from '../website/assets/nfl-game-lab.mjs';

const context = (td, pace = 100) => ({scoringEnvironment:{projectedTeamTouchdownsBaseline:td,paceIndex:pace}});

test('game model returns complementary win, spread, and total probabilities', () => {
  const result = projectGame(context(2.8), context(2.2), {homeSpread:-2.5,total:45.5});
  assert.ok(result.homeWinProbability > .5);
  assert.equal(Math.round((result.homeWinProbability + result.awayWinProbability) * 100), 100);
  assert.equal(Math.round((result.homeCoverProbability + result.awayCoverProbability) * 100), 100);
  assert.equal(Math.round((result.overProbability + result.underProbability) * 100), 100);
});

test('missing market lines stay unavailable instead of becoming zero', () => {
  const result = projectGame(context(2.4), context(2.4));
  assert.equal(result.homeCoverProbability, null);
  assert.equal(result.overProbability, null);
  assert.equal(playerOverProbability(60, null, 'player_rush_yds'), null);
});

test('player market probability follows projection versus line', () => {
  assert.ok(playerOverProbability(75, 60, 'player_rush_yds') > .5);
  assert.ok(playerOverProbability(45, 60, 'player_rush_yds') < .5);
});

test('NFL AI board ranks the strongest read in each game market', () => {
  const contexts = ['AAA','BBB','CCC','DDD'].map((team,index)=>({team,scoringEnvironment:{projectedTeamTouchdownsBaseline:2+index*.5,paceIndex:100}}));
  const games = [{gameId:'1',awayTeam:'AAA',homeTeam:'BBB'},{gameId:'2',awayTeam:'CCC',homeTeam:'DDD'}];
  const ranked = rankGameMarkets(games,contexts,()=>({homeSpread:-1.5,total:45.5}));
  assert.equal(ranked.moneyline.length,2);
  assert.ok(ranked.moneyline[0].edge>=ranked.moneyline[1].edge);
  assert.equal(ranked.spread.length,2);
  assert.equal(ranked.total.length,2);
  assert.equal(americanPrice(.6),-150);
});

test('Game Lab renders expandable team and player intelligence', async () => {
  const js = await readFile(new URL('../website/assets/nfl-lab.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../website/assets/nfl-lab.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../website/nfl.html', import.meta.url), 'utf8');
  for (const label of ['Moneyline','Spread','Total','BEST PLAYER ANGLES','THE SLIP LAB MODEL ESTIMATE']) assert.ok(js.includes(label));
  assert.match(js, /get\('odds_nfl'\)/);
  assert.match(js, /class="game-lab-card"/);
  assert.match(js, /class="game-pick[^\"]*" data-player-id=/);
  assert.match(css, /\.game-market-grid/);
  assert.doesNotMatch(html, /data-disable-odds/);
});
