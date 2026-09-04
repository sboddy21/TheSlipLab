import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('health publication cannot extend expired source inputs during a long refresh', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slip-health-test-'));
  const dataDir = path.join(root, 'website/data');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = Date.now();
  const updatedAt = new Date(now - 20 * 60000).toISOString();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const common = { date, updatedAt };
  const files = {
    'mlb_games_today.json': { ...common, games: [{}] },
    'mlb_player_pool.json': { ...common, players: [{}] },
    'mlb_home_runs.json': [{}],
    'game_pitcher_matchups.json': { ...common, games: [{}] },
    'hr_decision_center.json': { ...common, pitcherDate: date, allPlayers: [{}] },
    'mlb_weather.json': { ...common, weather: [{}] },
    'mlb_results.json': { ...common, homeRuns: [] }
  };
  try {
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
    const result = spawnSync(process.execPath, [path.resolve('scripts/build_health_status.js')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, SL_HEALTH_STATE: '', MLB_REFRESH_STARTED_AT: String(now - 25 * 60000) }
    });
    assert.equal(result.status, 0, result.stderr);
    const health = JSON.parse(fs.readFileSync(path.join(dataDir, 'health_status.json')));
    assert.equal(health.status, 'delayed');
    assert.equal(health.monitoring.state, 'delayed');
    assert(Date.parse(health.monitoring.freshUntil) <= now);
    assert.equal(health.artifacts.games.maxAgeSeconds, 900);
    assert.equal(health.artifacts.hrBoard.maxAgeSeconds, 4200);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
