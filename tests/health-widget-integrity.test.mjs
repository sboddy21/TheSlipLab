import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('website/health-widget.js', 'utf8');
const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
function healthy() {
  return { status: 'healthy', slateDate: today, monitoring: { state: 'live', checkedAt: iso(-1000), freshUntil: iso(600000) }, artifacts: {
    games: { file: 'mlb_games_today.json', required: true, freshness: 'current', timestamp: iso(-1000), maxAgeSeconds: 900 }
  } };
}
async function render(data, { nfl = false, fail = false } = {}) {
  const elements = new Map();
  const element = () => ({ dataset: {}, style: {}, innerHTML: '', textContent: '', appendChild() {}, addEventListener() {} });
  const getElementById = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let request;
  const context = {
    Date, Intl, console, AbortSignal, setInterval() {},
    document: { body: { classList: { contains: () => nfl }, appendChild() {} }, head: { appendChild() {} }, createElement: element, querySelector: element, getElementById },
    window: { location: { pathname: nfl ? '/nfl.html' : '/mlb.html' }, TSLAccount: { accessToken: async () => 'test-token' } },
    fetch: async (url, options) => { request = options; return { ok: !fail, status: fail ? 401 : 200, json: async () => data }; }
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { label: getElementById('slHealthLabel').textContent, request };
}
test('current complete MLB health can be live', async () => assert.equal((await render(healthy())).label, 'MLB LIVE'));
test('MLB cannot claim live without expiry, check time, slate or source evidence', async () => {
  for (const mutate of [d => delete d.monitoring.freshUntil, d => delete d.monitoring.checkedAt, d => d.slateDate = '2000-01-01', d => d.artifacts = {}, d => d.monitoring.checkedAt = iso(60000)]) {
    const d = healthy(); mutate(d); assert.equal((await render(d)).label, 'MLB CHECK');
  }
});
test('fresh health timestamp cannot hide expired underlying inputs', async () => {
  const d = healthy(); d.artifacts.games.timestamp = iso(-960000);
  assert.equal((await render(d)).label, 'MLB DELAYED');
});
test('failed NFL request never becomes live and uses subscriber authorization', async () => {
  const result = await render({}, { nfl: true, fail: true });
  assert.equal(result.label, 'NFL CHECK');
  assert.equal(result.request.headers.Authorization, 'Bearer test-token');
});
test('NFL requires a complete current explicitly public audit', async () => {
  const audit = { checkedAt: iso(-1000), criticalIdentityIssues: 0, blockerCount: 0, publicNavigationEnabled: true };
  const payload = launchAudit => ({ sources: { launchAudit } });
  assert.equal((await render(payload(audit), { nfl: true })).label, 'NFL LIVE');
  assert.equal((await render({}, { nfl: true })).label, 'NFL CHECK');
  assert.equal((await render(payload({ ...audit, checkedAt: iso(-3600001) }), { nfl: true })).label, 'NFL DELAYED');
  assert.equal((await render(payload({ ...audit, publicNavigationEnabled: false }), { nfl: true })).label, 'NFL BUILDING');
});
