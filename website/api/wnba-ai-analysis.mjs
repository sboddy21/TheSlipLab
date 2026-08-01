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

function cleanNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanPlayer(player) {
  const projections = {};
  for (const market of ["points", "rebounds", "assists", "threes"]) {
    projections[market] = {
      value: cleanNumber(player?.projections?.[market]?.value, 0),
      floor: cleanNumber(player?.projections?.[market]?.floor, 0),
      ceiling: cleanNumber(player?.projections?.[market]?.ceiling, 0)
    };
  }
  return {
    playerId: String(player?.playerId || "").slice(0, 40),
    player: String(player?.player || "Unknown").slice(0, 80),
    team: String(player?.team || "").slice(0, 8),
    opponent: String(player?.opponent || "").slice(0, 8),
    role: String(player?.role || "rotation").slice(0, 40),
    roleScore: cleanNumber(player?.roleScore, 0),
    expectedMinutes: cleanNumber(player?.expectedMinutes, 0),
    confidence: cleanNumber(player?.confidence, 0),
    projections,
    context: {
      paceFactor: cleanNumber(player?.context?.paceFactor, 1),
      opponentDefenseFactor: cleanNumber(player?.context?.opponentDefenseFactor, 1),
      opponentDefenseRank: cleanNumber(player?.context?.opponentDefenseRank),
      recentMinutesDelta: cleanNumber(player?.context?.recentMinutesDelta, 0),
      recentPointsDelta: cleanNumber(player?.context?.recentPointsDelta, 0),
      injury: player?.context?.injury ? String(player.context.injury).slice(0, 120) : null
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
  required: ["summary", "insights"],
  properties: {
    summary: { type: "string" },
    insights: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["playerId", "player", "team", "headline", "analysis", "signals"],
        properties: {
          playerId: { type: "string" },
          player: { type: "string" },
          team: { type: "string" },
          headline: { type: "string" },
          analysis: { type: "string" },
          signals: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } }
        }
      }
    }
  }
};

export default async function handler(request, response) {
  if (request.method === "GET") {
    return json(response, 200, { configured: Boolean(process.env.OPENAI_API_KEY), model: MODEL });
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) return json(response, 503, { error: "AI analysis is not configured" });
    const user = await authenticatedUser(request);
    if (!user?.id) return json(response, 401, { error: "Sign in to use WNBA AI Says" });

    const slate = request.body?.slate || {};
    const players = (Array.isArray(slate.players) ? slate.players : []).slice(0, 20).map(cleanPlayer).filter(player => player.playerId && player.player);
    if (!players.length) return json(response, 400, { error: "No eligible WNBA players were supplied" });
    const date = String(slate.date || "current slate").slice(0, 20);
    const version = String(slate.generatedAt || "").slice(0, 40);
    const cacheKey = `${date}:${version}`;
    if (memoryCache.has(cacheKey)) return json(response, 200, memoryCache.get(cacheKey));

    const prompt = [
      "Analyze only the supplied WNBA slate data. The numerical projections are authoritative inputs; do not alter them or invent facts.",
      "Identify the most meaningful players using expected minutes, role, recent-form deltas, pace, opponent defense, injuries, projection ranges, and confidence.",
      "Explain why each selected player stands out in specific basketball language. Avoid generic summaries and avoid repeating every number.",
      "Do not present sportsbook lines, wagers, guarantees, or fabricated news. Produce a concise daily overview and 4-8 distinct player insights."
    ].join(" ");

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: "low" },
        input: [
          { role: "developer", content: [{ type: "input_text", text: prompt }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify({ sport: "WNBA", date, players }) }] }
        ],
        text: { verbosity: "medium", format: { type: "json_schema", name: "wnba_daily_analysis", strict: true, schema } },
        max_output_tokens: 2400
      }),
      signal: AbortSignal.timeout(28000)
    });
    const payload = await openaiResponse.json().catch(() => ({}));
    if (!openaiResponse.ok) throw new Error(payload?.error?.message || "OpenAI analysis failed");
    const parsed = JSON.parse(outputText(payload));
    const result = { source: "openai", model: MODEL, generatedAt: new Date().toISOString(), slateDate: date, summary: parsed.summary, insights: parsed.insights };
    memoryCache.set(cacheKey, result);
    if (memoryCache.size > 8) memoryCache.delete(memoryCache.keys().next().value);
    return json(response, 200, result);
  } catch (error) {
    return json(response, 502, { error: error.message || "WNBA AI analysis failed" });
  }
}
