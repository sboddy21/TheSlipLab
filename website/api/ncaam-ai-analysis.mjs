import { authorize } from './member-data.mjs';
import { json } from '../lib/account-server.mjs';
import { checkDataFreshness } from '../lib/data-freshness.mjs';
import { loadNcaamLiveBoard } from '../lib/ncaam-live.mjs';
import { createPublishedDataReader } from '../lib/published-data.mjs';

const cache = new Map();
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['rationale', 'uncertainty'],
  properties: {
    rationale: { type: 'string' },
    uncertainty: { type: 'string' }
  }
};

async function loadBoard() {
  const read = createPublishedDataReader();
  return loadNcaamLiveBoard(() => read('ncaam_board.json'));
}

function matchupFacts(game) {
  const team = (side, rating) => ({
    name: side.name,
    elo: Number.isFinite(rating) ? Math.round(rating) : null,
    record: side.record,
    rank: side.rank,
    pointsPerGame: side.stats?.avgPoints ?? null,
    fieldGoalPercentage: side.stats?.fieldGoalPct ?? null
  });
  const prediction = game.prediction;
  return {
    gameId: game.id,
    kickoff: game.kickoff,
    modelVersion: prediction.modelVersion,
    selection: game[prediction.side].name,
    winProbability: prediction.probability,
    home: team(game.home, prediction.homeRating),
    away: team(game.away, prediction.awayRating),
    neutralCourt: game.neutral,
    earlySeasonCarryover: prediction.earlySeason
  };
}

async function generate(facts, model, key) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      input: [
        {
          role: 'developer',
          content: 'Write a short pregame college basketball read using only the supplied facts. In rationale, explain how the Elo ratings and home or neutral court affect the listed winner forecast. Raw scoring and shooting averages are descriptive context, separate from Elo inputs. In uncertainty, explain relevant limitations such as early-season carryover and single-game variance. Use one or two sentences per field. Keep the supplied pick and probability. Do not invent any lines, injuries, news, statistics, scores, bets, or probabilities.'
        },
        { role: 'user', content: JSON.stringify(facts) }
      ],
      text: { format: { type: 'json_schema', name: 'ncaam_matchup_read', strict: true, schema } },
      max_output_tokens: 900
    })
  });
  if (!response.ok) {
    console.error('NCAAM analysis provider status', response.status);
    throw new Error('AI provider unavailable');
  }
  const payload = await response.json();
  const output = payload.output?.flatMap(item => item.content || [])
    .find(item => item.type === 'output_text')?.text;
  const analysis = JSON.parse(output || '{}');
  for (const field of ['rationale', 'uncertainty']) {
    if (typeof analysis[field] !== 'string' || !analysis[field].trim()) {
      throw new Error('Incomplete AI read');
    }
  }
  return { rationale: analysis.rationale, uncertainty: analysis.uncertainty };
}

export function createNcaamAnalysisHandler({
  checkAccess = authorize, readBoard = loadBoard, writeRead = generate,
  apiKey = () => process.env.OPENAI_API_KEY
} = {}) {
  return async function handler(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return json(response, 405, { error: 'Method not allowed' });
    }
    try {
      const access = await checkAccess(request);
      if (!access.allowed) {
        return json(response, access.status, {
          error: access.status === 401 ? 'Sign in to use AI Says.' : 'Member access is required.'
        });
      }
      const gameId = request.body?.gameId;
      if (typeof gameId !== 'string' || !/^\d{1,20}$/.test(gameId)) {
        return json(response, 400, { error: 'Choose a matchup from today’s slate.' });
      }
      const key = apiKey();
      if (!key) return json(response, 503, { error: 'AI reads are temporarily unavailable.' });

      const board = await readBoard();
      if (!checkDataFreshness('ncaam_board.json', board).available) {
        return json(response, 503, { error: 'The current slate could not be verified. Refresh and try again.' });
      }
      const game = board.games.find(row => String(row.id) === gameId);
      if (board.model?.status !== 'validated_winner_forecasts' || !game?.prediction?.eligible
        || game.state !== 'pre' || !(Date.parse(game.kickoff) > Date.now())
        || !['home', 'away'].includes(game.prediction.side)
        || !Number.isFinite(game.prediction.probability)) {
        return json(response, 409, { error: 'This matchup has no current pregame forecast.' });
      }

      const facts = matchupFacts(game);
      const model = process.env.NCAAM_AI_MODEL || 'gpt-5.6-sol';
      const cacheKey = JSON.stringify([model, facts]);
      let read = cache.get(cacheKey);
      if (!read) {
        read = Promise.resolve().then(() => writeRead(facts, model, key));
        cache.set(cacheKey, read);
        read.catch(() => { if (cache.get(cacheKey) === read) cache.delete(cacheKey); });
        if (cache.size > 96) cache.delete(cache.keys().next().value);
      }
      const analysis = await read;
      if (Date.parse(game.kickoff) <= Date.now()) {
        return json(response, 409, { error: 'This matchup has reached tipoff.' });
      }
      return json(response, 200, {
        ...analysis, gameId, probability: facts.winProbability, selection: facts.selection
      });
    } catch (error) {
      console.error('NCAAM AI read failed', error.name);
      return json(response, 502, { error: 'The AI read is temporarily unavailable. Try again shortly.' });
    }
  };
}

export default createNcaamAnalysisHandler();
