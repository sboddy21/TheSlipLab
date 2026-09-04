import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('website/hr-decision-center.html', 'utf8');
const body = html.match(/function verifiedBoardDeadline[\s\S]*?(?=\nfunction clean\()/)?.[0];
assert(body, 'freshness gate must remain present');
const verifiedBoardDeadline = new Function(`${body}; return verifiedBoardDeadline`)();
const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const board = { pitcherDate: today, updatedAt: iso(-1000) };
const health = { status: 'healthy', slateDate: today, monitoring: { state: 'live', freshUntil: iso(600000) }, artifacts: {
  games: { file: 'mlb_games_today.json', required: true, freshness: 'current', timestamp: iso(-1000), maxAgeSeconds: 900 }
} };

test('MLB Decision Center permits only a current complete health chain', () => assert(verifiedBoardDeadline(board, health) > now));
test('MLB Decision Center withholds picks for stale, missing, future or wrong-slate evidence', () => {
  const cases = [
    [{ ...board, updatedAt: iso(-901000) }, health],
    [board, { ...health, status: 'delayed' }],
    [board, { ...health, slateDate: '2000-01-01' }],
    [board, { ...health, artifacts: {} }],
    [board, { ...health, artifacts: { games: { ...health.artifacts.games, timestamp: iso(-901000) } } }],
    [board, { ...health, artifacts: { games: { ...health.artifacts.games, timestamp: iso(60000) } } }]
  ];
  for (const [candidate, status] of cases) assert(verifiedBoardDeadline(candidate, status) <= now);
});
