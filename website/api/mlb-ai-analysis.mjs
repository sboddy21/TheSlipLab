const MODEL = "gpt-5.6-sol";
const memoryCache = new Map();

function json(response, status, payload) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  return response.status(status).json(payload);
}

function bearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function authenticatedUser(request) {
  const token = bearerToken(request);
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!token || !url || !serviceKey) return null;
  const userResponse = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  return userResponse.ok ? userResponse.json() : null;
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, length = 120) {
  return String(value || "").slice(0, length);
}

function stringList(values, limit = 5) {
  return (Array.isArray(values) ? values : []).slice(0, limit).map(value => text(value, 180)).filter(Boolean);
}

function cleanPlayer(player) {
  return {
    playerId: text(player?.playerId, 40),
    player: text(player?.player, 80),
    team: text(player?.team, 80),
    opponent: text(player?.opponent, 80),
    pitcher: text(player?.pitcher, 80),
    section: text(player?.section, 50),
    tags: stringList(player?.tags, 6),
    aiScore: number(player?.aiScore, 0),
    hrScore: number(player?.hrScore),
    powerScore: number(player?.powerScore),
    recentForm: number(player?.recentForm),
    odds: text(player?.odds, 30),
    reasoning: {
      verdict: text(player?.reasoning?.verdict, 80),
      probability: number(player?.reasoning?.probability),
      confidence: number(player?.reasoning?.confidence),
      stars: number(player?.reasoning?.stars),
      whyToday: stringList(player?.reasoning?.whyToday, 6),
      riskFactors: stringList(player?.reasoning?.riskFactors, 5),
      trustBreakdown: player?.reasoning?.trustBreakdown || {},
      homeRunDNA: player?.reasoning?.homeRunDNA || {}
    }
  };
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output || []).flatMap(item => item?.content || []).filter(part => part?.type === "output_text").map(part => part.text || "").join("");
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "slateThemes", "insights"],
  properties: {
    summary: { type: "string" },
    slateThemes: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
    insights: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["playerId", "player", "team", "headline", "analysis", "supportingSignals", "riskSignals"],
        properties: {
          playerId: { type: "string" },
          player: { type: "string" },
          team: { type: "string" },
          headline: { type: "string" },
          analysis: { type: "string" },
          supportingSignals: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
          riskSignals: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } }
        }
      }
    }
  }
};

export default async function handler(request, response) {
  if (request.method === "GET") return json(response, 200, { configured: Boolean(process.env.OPENAI_API_KEY), model: MODEL });
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) return json(response, 503, { error: "AI analysis is not configured" });
    const user = await authenticatedUser(request);
    if (!user?.id) return json(response, 401, { error: "Sign in to use MLB AI Says" });

    const slate = request.body?.slate || {};
    const players = (Array.isArray(slate.players) ? slate.players : []).slice(0, 24).map(cleanPlayer).filter(player => player.playerId && player.player);
    if (players.length < 4) return json(response, 400, { error: "Not enough MLB player profiles were supplied" });
    const generatedAt = text(slate.generatedAt, 40);
    const cacheKey = generatedAt || players.map(player => player.playerId).join(":");
    if (memoryCache.has(cacheKey)) return json(response, 200, memoryCache.get(cacheKey));

    const prompt = [
      "Analyze only the supplied MLB home-run model data. Every number and named matchup in the input is authoritative; do not alter it or invent facts.",
      "Synthesize the slate using independent evidence: tracked HR probability, HR power, contact damage, launch power, recent form, pitcher/matchup, environment, model trust, and counter-signals.",
      "Select 4-8 genuinely distinct hitters. Explain signal agreement and disagreement in specific baseball language rather than repeating raw fields.",
      "Treat counter-signals seriously. Do not fabricate lineup status, weather, odds, pitch types, injuries, or news when absent. Do not guarantee outcomes."
    ].join(" ");

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: "low" },
        input: [
          { role: "developer", content: [{ type: "input_text", text: prompt }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify({ sport: "MLB", market: "home_runs", players }) }] }
        ],
        text: { verbosity: "medium", format: { type: "json_schema", name: "mlb_daily_ai_analysis", strict: true, schema } },
        max_output_tokens: 3000
      }),
      signal: AbortSignal.timeout(28000)
    });
    const payload = await openaiResponse.json().catch(() => ({}));
    if (!openaiResponse.ok) throw new Error(payload?.error?.message || "OpenAI analysis failed");
    const parsed = JSON.parse(outputText(payload));
    const result = { source: "openai", model: MODEL, generatedAt: new Date().toISOString(), slateGeneratedAt: generatedAt, ...parsed };
    memoryCache.set(cacheKey, result);
    if (memoryCache.size > 8) memoryCache.delete(memoryCache.keys().next().value);
    return json(response, 200, result);
  } catch (error) {
    return json(response, 502, { error: error.message || "MLB AI analysis failed" });
  }
}
