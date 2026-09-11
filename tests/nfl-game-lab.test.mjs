import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectGame, playerOverProbability } from '../website/assets/nfl-game-lab.mjs';

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
