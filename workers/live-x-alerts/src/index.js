const MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule?sportId=1";
const MLB_LIVE_FEED_BASE = "https://statsapi.mlb.com/api/v1.1/game";
const DEFAULT_BOARD_URL = "https://thesliplab.com/ai-says.html";
const SUPABASE_TABLE = "x_live_events";

const SECTION_PRIORITY = [
  "TOP 5",
  "TOP 10",
  "ELITE SMASH",
  "LIVE LONGSHOTS"
];

const LIVE_GAME_STATES = new Set(["Live"]);

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runWatcher(env, {
      trigger: "scheduled",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime
    }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "slip-lab-live-x-alerts",
        livePostingEnabled: livePostingEnabled(env),
        eligibleSections: eligibleSections(env),
        cadence: "one live-game scan per scheduled run",
        maxEventAgeSeconds: maxEventAgeSeconds(env)
      });
    }

    if (url.pathname === "/run") {
      const auth = request.headers.get("authorization") || "";
      const expected = env.ADMIN_TOKEN ? `Bearer ${env.ADMIN_TOKEN}` : "";
      if (!expected || auth !== expected) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      const result = await runWatcher(env, {
        trigger: "manual",
        once: url.searchParams.get("once") === "1"
      });
      return json(result);
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
};

async function runWatcher(env, meta = {}) {
  validateEnv(env);

  const startedAt = new Date().toISOString();
  const summary = {
    ok: true,
    trigger: meta.trigger || "unknown",
    startedAt,
    finishedAt: null,
    livePostingEnabled: livePostingEnabled(env),
    loops: 0,
    gamesScanned: 0,
    homeRunsScanned: 0,
    matchedEvents: 0,
    insertedEvents: 0,
    postedEvents: 0,
    dryRunEvents: 0,
    skippedEvents: 0,
    failedEvents: 0,
    errors: []
  };

  const ai = await fetchAiBoard(env);
  const aiIndex = buildAiIndex(ai, eligibleSections(env));

  summary.loops += 1;
  try {
    const result = await checkOnce(env, aiIndex);
    mergeSummary(summary, result);
  } catch (error) {
    summary.errors.push(error.message);
    summary.failedEvents += 1;
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}

async function checkOnce(env, aiIndex) {
  const date = easternDate();
  const games = await fetchActiveGames(date);
  const result = {
    gamesScanned: games.length,
    homeRunsScanned: 0,
    matchedEvents: 0,
    insertedEvents: 0,
    postedEvents: 0,
    dryRunEvents: 0,
    skippedEvents: 0,
    failedEvents: 0
  };

  for (const game of games) {
    const feed = await getJson(`${MLB_LIVE_FEED_BASE}/${game.gamePk}/feed/live`);
    const events = homeRunEvents({ date, game, feed, maxAgeSeconds: maxEventAgeSeconds(env) });
    result.homeRunsScanned += events.length;

    for (const event of events) {
      const match = matchAi(event, aiIndex);
      if (!match) continue;
      result.matchedEvents += 1;

      const text = fitTweet(buildTweet(event, match));
      const baseRow = {
        event_key: event.eventKey,
        date: event.date,
        event_type: "called_it_home_run",
        player_id: event.playerId || null,
        player_name: event.player,
        game_pk: event.gamePk,
        play_id: event.playId === null || event.playId === undefined ? null : String(event.playId),
        ai_section: match.primary.section,
        ai_rank: match.primary.rank,
        tweet_text: text,
        payload: { event, ai: match.memberships }
      };

      const existing = await supabaseGetEvent(env, event.eventKey);
      if (existing) {
        result.skippedEvents += 1;
        continue;
      }

      if (!livePostingEnabled(env)) {
        await supabaseInsertEvent(env, { ...baseRow, status: "dry_run" });
        result.insertedEvents += 1;
        result.dryRunEvents += 1;
        if (result.postedEvents + result.dryRunEvents >= maxPostsPerRun(env)) {
          return result;
        }
        continue;
      }

      const inserted = await supabaseInsertEvent(env, { ...baseRow, status: "pending" });
      if (!inserted) {
        result.skippedEvents += 1;
        continue;
      }
      result.insertedEvents += 1;

      try {
        const xPostId = await postTweet(env, text);
        await supabasePatchEvent(env, event.eventKey, {
          status: "posted",
          x_post_id: xPostId,
          posted_at: new Date().toISOString(),
          error: null
        });
        result.postedEvents += 1;
      } catch (error) {
        await supabasePatchEvent(env, event.eventKey, {
          status: "failed",
          error: error.message
        });
        result.failedEvents += 1;
      }

      if (result.postedEvents + result.dryRunEvents >= maxPostsPerRun(env)) {
        return result;
      }
    }
  }

  return result;
}

function validateEnv(env) {
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[key]) throw new Error(`Missing required secret: ${key}`);
  }

  if (livePostingEnabled(env)) {
    for (const key of ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"]) {
      if (!env[key]) throw new Error(`Missing required X secret while live posting is enabled: ${key}`);
    }
  }
}

function livePostingEnabled(env) {
  return String(env.X_CALLED_IT_LIVE || "false").toLowerCase() === "true";
}

function maxEventAgeSeconds(env) {
  return clamp(Number(env.MAX_EVENT_AGE_SECONDS || 180), 30, 600);
}

function maxPostsPerRun(env) {
  return clamp(Number(env.MAX_POSTS_PER_RUN || 1), 1, 5);
}

function eligibleSections(env) {
  const raw = String(env.ELIGIBLE_SECTIONS || SECTION_PRIORITY.join(","));
  return raw.split(",").map(item => item.trim().toUpperCase()).filter(Boolean);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "accept": "application/json" }
  });
  if (!response.ok) throw new Error(`Request failed ${response.status}: ${url}`);
  return response.json();
}

function easternDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function fetchActiveGames(date) {
  const schedule = await getJson(`${MLB_SCHEDULE_URL}&date=${date}`);
  return (schedule?.dates?.[0]?.games || [])
    .filter(game => LIVE_GAME_STATES.has(String(game?.status?.abstractGameState || "")));
}

async function fetchAiBoard(env) {
  return getJson(env.AI_SAYS_URL || "https://www.thesliplab.com/data/ai_2.json");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildAiIndex(ai, allowedSections) {
  const allowed = new Set(allowedSections);
  const byId = new Map();
  const byName = new Map();

  for (const section of Array.isArray(ai?.sections) ? ai.sections : []) {
    const sectionName = String(section?.title || section?.name || section?.category || "").trim().toUpperCase();
    if (!allowed.has(sectionName)) continue;

    const players = Array.isArray(section?.players) ? section.players : [];
    for (const [index, player] of players.entries()) {
      const playerId = player?.playerId ? String(player.playerId) : "";
      const name = String(player?.name || player?.player || player?.batter || "").trim();
      const entry = {
        section: sectionName,
        rank: index + 1,
        playerId,
        name
      };
      if (playerId) mapPush(byId, playerId, entry);
      if (name) mapPush(byName, normalizeName(name), entry);
    }
  }

  return { byId, byName };
}

function mapPush(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function matchAi(event, index) {
  const memberships = [
    ...(index.byId.get(String(event.playerId || "")) || []),
    ...(index.byName.get(normalizeName(event.player)) || [])
  ];
  const unique = [];
  const seen = new Set();

  for (const item of memberships) {
    const key = `${item.section}:${item.rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  unique.sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section) || a.rank - b.rank);
  return unique.length ? { primary: unique[0], memberships: unique.slice(0, 3) } : null;
}

function sectionOrder(section) {
  const index = SECTION_PRIORITY.indexOf(section);
  return index === -1 ? SECTION_PRIORITY.length : index;
}

function homeRunEvents({ date, game, feed, maxAgeSeconds }) {
  const allPlays = feed?.liveData?.plays?.allPlays || [];
  const now = Date.now();
  const rows = [];

  for (const play of allPlays) {
    if (!isHomeRun(play)) continue;

    const endTime = play?.about?.endTime || play?.about?.startTime || "";
    const endMs = Date.parse(endTime);
    if (!Number.isFinite(endMs) || now - endMs < 0 || now - endMs > maxAgeSeconds * 1000) continue;

    const pitch = lastPitch(play);
    const hitData = pitch?.hitData || {};
    const batter = play?.matchup?.batter || {};
    const pitcher = play?.matchup?.pitcher || {};

    rows.push({
      eventKey: eventKey(game.gamePk, play, batter),
      date,
      gamePk: game.gamePk,
      playId: play?.about?.atBatIndex ?? null,
      playerId: batter?.id ?? null,
      player: batter?.fullName || "",
      pitcherId: pitcher?.id ?? null,
      pitcher: pitcher?.fullName || "",
      team: teamName(play, feed),
      opponent: opponentName(play, feed),
      game: gameLabel(feed, game),
      inning: inningLabel(play),
      distance: rounded(hitData?.totalDistance, 0),
      exitVelocity: rounded(hitData?.launchSpeed, 1),
      launchAngle: rounded(hitData?.launchAngle, 0),
      endTime,
      description: play?.result?.description || ""
    });
  }

  return rows;
}

function isHomeRun(play) {
  const event = String(play?.result?.event || "").toLowerCase();
  const eventType = String(play?.result?.eventType || "").toLowerCase();
  return event === "home run" || eventType === "home_run" || event.includes("home run");
}

function lastPitch(play) {
  return [...(play?.playEvents || [])].reverse().find(event => event?.isPitch || event?.type === "pitch") || {};
}

function eventKey(gamePk, play, batter) {
  return [
    "mlb",
    gamePk,
    play?.about?.atBatIndex ?? play?.about?.endTime ?? "play",
    batter?.id ?? normalizeName(batter?.fullName),
    "home_run"
  ].join(":");
}

function inningLabel(play) {
  const half = play?.about?.halfInning || "";
  const inning = play?.about?.inning || "";
  if (!inning) return "";
  return `${half ? half[0].toUpperCase() + half.slice(1) : ""} ${inning}`.trim();
}

function gameLabel(feed, game) {
  const away = feed?.gameData?.teams?.away?.name || game?.teams?.away?.team?.name || "";
  const home = feed?.gameData?.teams?.home?.name || game?.teams?.home?.team?.name || "";
  return away && home ? `${away} @ ${home}` : "";
}

function teamName(play, feed) {
  return feed?.liveData?.boxscore?.teams?.[play?.about?.isTopInning ? "away" : "home"]?.team?.name || "";
}

function opponentName(play, feed) {
  return feed?.liveData?.boxscore?.teams?.[play?.about?.isTopInning ? "home" : "away"]?.team?.name || "";
}

function rounded(value, digits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function buildTweet(event, match) {
  const headline = match.primary.section === "LIVE LONGSHOTS"
    ? "🚨 SLIP LAB LONGSHOT HIT"
    : match.primary.section === "TOP 5"
      ? "🚨 TOP 5 HR HIT"
      : match.primary.section === "TOP 10"
        ? "🚨 TOP 10 HR HIT"
        : "🚨 SLIP LAB CALLED IT";
  const tags = match.memberships.map(item => `${item.section} #${item.rank}`).join(" · ");
  const stats = [
    event.distance ? `${event.distance} ft` : "",
    event.exitVelocity ? `${event.exitVelocity} mph EV` : "",
    event.launchAngle ? `${event.launchAngle}° LA` : ""
  ].filter(Boolean).join(" · ");

  return [
    headline,
    "",
    `${event.player} just homered.`,
    "",
    `AI Says: ${tags}`,
    event.game,
    event.inning,
    stats,
    event.pitcher ? `Off ${event.pitcher}` : "",
    "",
    `Board: ${DEFAULT_BOARD_URL}`
  ].filter(line => line !== "").join("\n").trim();
}

function fitTweet(text) {
  if (text.length <= 280) return text;

  const withoutBoard = text
    .split("\n")
    .filter(line => !line.startsWith("Board: "))
    .join("\n")
    .trim();
  if (withoutBoard.length <= 280) return withoutBoard;

  const withoutPitcher = withoutBoard
    .split("\n")
    .filter(line => !line.startsWith("Off "))
    .join("\n")
    .trim();
  if (withoutPitcher.length <= 280) return withoutPitcher;

  return `${withoutPitcher.slice(0, 276).trim()}…`;
}

function supabaseHeaders(env, extra = {}) {
  return {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

function supabaseUrl(env, path) {
  return `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/${path}`;
}

async function supabaseGetEvent(env, eventKey) {
  const url = supabaseUrl(env, `${SUPABASE_TABLE}?event_key=eq.${encodeURIComponent(eventKey)}&select=id,status,x_post_id&limit=1`);
  const response = await fetch(url, { headers: supabaseHeaders(env) });
  if (!response.ok) throw new Error(`Supabase lookup failed ${response.status}: ${await response.text()}`);
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function supabaseInsertEvent(env, row) {
  const response = await fetch(supabaseUrl(env, SUPABASE_TABLE), {
    method: "POST",
    headers: supabaseHeaders(env, {
      "content-type": "application/json",
      "prefer": "return=representation"
    }),
    body: JSON.stringify(row)
  });

  if (response.status === 409) return null;
  if (!response.ok) throw new Error(`Supabase insert failed ${response.status}: ${await response.text()}`);
  return (await response.json())?.[0] || null;
}

async function supabasePatchEvent(env, eventKey, patch) {
  const response = await fetch(supabaseUrl(env, `${SUPABASE_TABLE}?event_key=eq.${encodeURIComponent(eventKey)}`), {
    method: "PATCH",
    headers: supabaseHeaders(env, {
      "content-type": "application/json",
      "prefer": "return=minimal"
    }),
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error(`Supabase patch failed ${response.status}: ${await response.text()}`);
}

async function postTweet(env, text) {
  const url = "https://api.twitter.com/2/tweets";
  const body = JSON.stringify({ text });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": await oauthHeader(env, "POST", url),
      "content-type": "application/json"
    },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`X post failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload?.data?.id || null;
}

async function oauthHeader(env, method, url) {
  const params = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0"
  };

  const signatureParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${percent(key)}=${percent(value)}`)
    .join("&");
  const baseString = [
    method.toUpperCase(),
    percent(url),
    percent(signatureParams)
  ].join("&");
  const signingKey = `${percent(env.X_API_SECRET)}&${percent(env.X_ACCESS_SECRET)}`;
  const signature = await hmacSha1(signingKey, baseString);

  return "OAuth " + Object.entries({ ...params, oauth_signature: signature })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${percent(key)}="${percent(value)}"`)
    .join(", ");
}

async function hmacSha1(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return arrayBufferToBase64(signature);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function percent(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function mergeSummary(target, result) {
  for (const key of [
    "gamesScanned",
    "homeRunsScanned",
    "matchedEvents",
    "insertedEvents",
    "postedEvents",
    "dryRunEvents",
    "skippedEvents",
    "failedEvents"
  ]) {
    target[key] += result[key] || 0;
  }
}
