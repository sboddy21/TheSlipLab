import test from 'node:test';
import assert from 'node:assert/strict';
import { createNcaamAnalysisHandler } from '../website/api/ncaam-ai-analysis.mjs';
import { easternDate } from '../scripts/ncaam/core.mjs';

async function request(handler, body) {
  const response = {
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  await handler({ method: 'POST', body, headers: {} }, response);
  return response;
}

test('AI Says uses the server forecast and never accepts a client-supplied prediction', async () => {
  const game = {
    id: '456', state: 'pre', kickoff: new Date(Date.now() + 3_600_000).toISOString(),
    home: { name: 'Home', record: '2-0' }, away: { name: 'Away', record: '1-1' },
    prediction: { side: 'home', eligible: true, probability: 0.71, homeRating: 1600, awayRating: 1510 }
  };
  const handler = createNcaamAnalysisHandler({
    checkAccess: async () => ({ allowed: true }),
    apiKey: () => 'test-key',
    readBoard: async () => ({
      sport: 'NCAAM', date: easternDate(), generatedAt: new Date().toISOString(),
      model: { status: 'validated_winner_forecasts' }, games: [game]
    }),
    writeRead: async facts => {
      assert.equal(facts.selection, 'Home');
      assert.equal(facts.winProbability, 0.71);
      assert.equal(facts.home.elo, 1600);
      return { rationale: 'Home has the higher Elo.', uncertainty: 'Single-game variance remains.' };
    }
  });
  const result = await request(handler, { gameId: '456', probability: 0.99, selection: 'Away' });
  assert.equal(result.code, 200);
  assert.equal(result.payload.probability, 0.71);
  game.state = 'in';
  assert.equal((await request(handler, { gameId: '456' })).code, 409);
});

test('AI Says requires member access before loading the slate or calling the provider', async () => {
  const handler = createNcaamAnalysisHandler({
    checkAccess: async () => ({ allowed: false, status: 401 }),
    readBoard: () => assert.fail('Unauthorized request reached the slate'),
    writeRead: () => assert.fail('Unauthorized request reached the AI provider')
  });
  assert.equal((await request(handler, { gameId: '456' })).code, 401);
});
