import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchScoreboard, scoreboardDates } from '../scripts/cfb/scoreboard.mjs';
import { fetchLive } from '../website/api/cfb-live.mjs';

test('live feed requests every day and retains Saturday evening games', async () => {
  const dates = [];
  const lateGame = { id: 'late', date: '2026-10-31T23:30:00Z',
    status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '1' } },
      { homeAway: 'away', team: { id: '2' } },
    ] }],
  };
  const board = await fetchLive(async url => {
    const date = new URL(url).searchParams.get('dates');
    dates.push(date);
    return new Response(JSON.stringify({ events: date === '20261031' ? [lateGame] : [] }));
  }, Date.parse('2026-10-31T22:36:00Z'));
  assert.deepEqual(dates.sort(), ['20261026','20261027','20261028','20261029','20261030','20261031','20261101']);
  assert.equal(board.games.length, 1);
  assert.equal(board.games[0].state, 'pre');
  assert.ok(Date.parse(board.games[0].date) > Date.parse(board.retrievedAt));
});

test('scoreboardDates expands an inclusive range into ESPN single-day keys', () => {
  assert.deepEqual(
    scoreboardDates(new Date('2026-09-18T23:30:00Z'), new Date('2026-09-20T12:00:00Z')),
    ['20260918', '20260919', '20260920'],
  );
});

test('fetchScoreboard never sends ESPN a date range and deduplicates events', async () => {
  const urls = [];
  const mockFetch = async url => {
    urls.push(url);
    const date = new URL(url).searchParams.get('dates');
    return new Response(JSON.stringify({ events: [{ id: 'shared' }, { id: date }] }), { status: 200 });
  };
  const events = await fetchScoreboard(
    new Date('2026-09-18T00:00:00Z'),
    new Date('2026-09-20T00:00:00Z'),
    mockFetch,
  );
  assert.deepEqual(urls.map(url => new URL(url).searchParams.get('dates')).sort(), ['20260918', '20260919', '20260920']);
  assert.ok(urls.every(url => !new URL(url).searchParams.get('dates').includes('-')));
  assert.deepEqual(events.map(event => event.id), ['shared', '20260918', '20260919', '20260920']);
});

test('fetchScoreboard reports the rejected calendar day and ESPN response', async () => {
  const mockFetch = async () => new Response('{"message":"Failed to get events endpoint."}', { status: 400 });
  await assert.rejects(
    fetchScoreboard(new Date('2026-09-18T00:00:00Z'), new Date('2026-09-18T00:00:00Z'), mockFetch),
    /ESPN returned 400 for 20260918.*Failed to get events endpoint/,
  );
});

test('scoreboard keeps every game beyond the old 34-game slate', async () => {
  const events = Array.from({length: 90}, (_, i) => ({id: String(i)}));
  const result = await fetchScoreboard(new Date('2026-10-31T00:00Z'), new Date('2026-10-31T00:00Z'),
    async () => new Response(JSON.stringify({events})));
  assert.deepEqual(result, events);
});

test('live feed rejects silently dropped games', async () => {
  await assert.rejects(fetchLive(async () => new Response(JSON.stringify({events: [{id: 'missing-teams'}]})),
    Date.parse('2026-10-31T22:36Z')), /Incomplete college football feed/);
});

test('a failed day cannot publish a partial week', async () => {
  await assert.rejects(fetchScoreboard(new Date('2026-10-30T00:00Z'), new Date('2026-10-31T00:00Z'), async url => {
    return new URL(url).searchParams.get('dates') === '20261031'
      ? new Response('unavailable', {status: 400})
      : new Response(JSON.stringify({events: [{id: 'friday'}]}));
  }), /20261031/);
});
