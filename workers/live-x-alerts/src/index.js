const MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule?sportId=1";
const MLB_LIVE_FEED_BASE = "https://statsapi.mlb.com/api/v1.1/game";
const DEFAULT_BOARD_URL = "https://thesliplab.com/ai-says.html";
const SUPABASE_TABLE = "x_live_events";

const SECTION_PRIORITY = [
  "TOP 5",
  "TOP 10",
  "HOMER AI",
  "ELITE SMASH",
  "SMASH + PARK",
  "SMASH SPOT",
  "LIVE LONGSHOTS",
  "TOP 30"
];

const DEFAULT_BOARD_HIT_SECTIONS = [
  "TOP 5",
  "TOP 10",
  "HOMER AI",
  "ELITE SMASH",
  "SMASH + PARK",
  "SMASH SPOT",
  "LIVE LONGSHOTS",
  "TOP 30"
];
const PREMIUM_HIT_SECTIONS = new Set(["TOP 5", "TOP 10"]);
const DEFAULT_LIVE_AI_UPDATE_SECTIONS = [
  "TOP 5",
  "TOP 10",
  "ELITE SMASH",
  "SMASH + PARK",
  "SMASH SPOT",
  "HOMER AI",
  "LIVE LONGSHOTS",
  "TOP 30"
];
const LIVE_GAME_STATES = new Set(["Live"]);
const HARD_HIT_MPH = 95;
const PREMIUM_HARD_HIT_MPH = 100;

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runWatcher(env, {
        trigger: "scheduled",
        cron: controller.cron,
        scheduledTime: controller.scheduledTime
      })
        .then(summary => {
          console.log("live-x-alerts summary", JSON.stringify(summary));
        })
        .catch(error => {
          console.error("live-x-alerts failed", error?.stack || error?.message || String(error));
        })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "slip-lab-live-x-alerts",
        livePostingEnabled: livePostingEnabled(env),
        liveAiUpdateDryRun: liveAiUpdateDryRun(env),
        eligibleSections: eligibleSections(env),
        liveAiUpdateSections: liveAiUpdateSections(env),
        cadence: "one live-game scan per scheduled run",
        maxEventAgeSeconds: maxEventAgeSeconds(env),
        maxPostsPerRun: maxPostsPerRun(env)
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
    hardHitPlayersScanned: 0,
    matchedEvents: 0,
    insertedEvents: 0,
    postedEvents: 0,
    dryRunEvents: 0,
    skippedEvents: 0,
    failedEvents: 0,
    duplicateStatusCounts: {},
    duplicateSamples: [],
    errors: []
  };

  const ai = await fetchAiBoard(env);
  const aiIndexes = {
    hitIndex: buildAiIndex(ai, eligibleSections(env)),
    liveUpdateIndex: buildAiIndex(ai, liveAiUpdateSections(env))
  };

  summary.loops += 1;
  try {
    const result = await checkOnce(env, aiIndexes);
    mergeSummary(summary, result);
  } catch (error) {
    summary.errors.push(error.message);
    summary.failedEvents += 1;
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}

async function checkOnce(env, aiIndexes) {
  const date = easternDate();
  const games = await fetchActiveGames(date);
  const result = {
    gamesScanned: games.length,
    homeRunsScanned: 0,
    hardHitPlayersScanned: 0,
    matchedEvents: 0,
    insertedEvents: 0,
    postedEvents: 0,
    dryRunEvents: 0,
    skippedEvents: 0,
    failedEvents: 0,
    duplicateStatusCounts: {},
    duplicateSamples: []
  };

  for (const game of games) {
    const feed = await getJson(`${MLB_LIVE_FEED_BASE}/${game.gamePk}/feed/live`);
    const events = homeRunEvents({ date, game, feed, maxAgeSeconds: maxEventAgeSeconds(env) });
    result.homeRunsScanned += events.length;

    for (const event of events) {
      const match = matchAi(event, aiIndexes.hitIndex);
      if (!match) continue;
      result.matchedEvents += 1;

      const eventType = "slip_lab_hit_home_run";
      const text = fitTweet(buildHomeRunTweet(event, match, eventType));
      const duplicate = await supabaseGetDuplicatePlay(env, event, ["called_it_home_run", "slip_lab_hit_home_run"]);
      if (duplicate) incrementDuplicateStatus(result, duplicate);
      if (duplicate && !retryableDuplicate(duplicate, env)) {
        result.skippedEvents += 1;
        continue;
      }

      const rowEventKey = duplicate?.event_key || eventKey(event, eventType);
      const baseRow = {
        event_key: rowEventKey,
        date: event.date,
        event_type: eventType,
        player_id: event.playerId || null,
        player_name: event.player,
        game_pk: event.gamePk,
        play_id: event.playId === null || event.playId === undefined ? null : String(event.playId),
        ai_section: match.primary.section,
        ai_rank: match.primary.rank,
        tweet_text: text,
        payload: { event, ai: match.memberships }
      };

      if (!livePostingEnabled(env)) {
        if (duplicate) {
          await supabasePatchEvent(env, rowEventKey, {
            ...eventPatch(baseRow),
            status: "dry_run",
            error: null
          });
        } else {
          await supabaseInsertEvent(env, { ...baseRow, status: "dry_run" });
        }
        result.insertedEvents += 1;
        result.dryRunEvents += 1;
        if (result.postedEvents + result.dryRunEvents >= maxPostsPerRun(env)) {
          return result;
        }
        continue;
      }

      if (duplicate) {
        await supabasePatchEvent(env, rowEventKey, {
          ...eventPatch(baseRow),
          status: "pending",
          error: null
        });
      } else {
        const inserted = await supabaseInsertEvent(env, { ...baseRow, status: "pending" });
        if (!inserted) {
          result.skippedEvents += 1;
          continue;
        }
      }
      result.insertedEvents += 1;

      try {
        const xPostId = await postTweet(env, text);
        await supabasePatchEvent(env, rowEventKey, {
          status: "posted",
          x_post_id: xPostId,
          posted_at: new Date().toISOString(),
          error: null
        });
        result.postedEvents += 1;
      } catch (error) {
        await supabasePatchEvent(env, rowEventKey, {
          status: "failed",
          error: error.message
        });
        result.failedEvents += 1;
      }

      if (result.postedEvents + result.dryRunEvents >= maxPostsPerRun(env)) {
        return result;
      }
    }

    const updateEvents = liveAiUpdateEvents({
      date,
      game,
      feed,
      aiIndex: aiIndexes.liveUpdateIndex,
      maxAgeSeconds: maxEventAgeSeconds(env),
      minConfidenceMove: minLiveAiConfidenceMove(env)
    });
    result.hardHitPlayersScanned += updateEvents.length;

    for (const event of updateEvents) {
      const rowEventKey = eventKey(event, "live_ai_update");
      const existing = await supabaseGetEvent(env, rowEventKey);
      if (existing) {
        result.skippedEvents += 1;
        continue;
      }

      const text = fitTweet(buildLiveAiUpdateTweet(event));
      await supabaseInsertEvent(env, {
        event_key: rowEventKey,
        date: event.date,
        event_type: "live_ai_update",
        player_id: event.playerId || null,
        player_name: event.player,
        game_pk: event.gamePk,
        play_id: event.latest?.playId === null || event.latest?.playId === undefined ? null : String(event.latest.playId),
        ai_section: event.match.primary.section,
        ai_rank: event.match.primary.rank,
        status: "dry_run",
        tweet_text: text,
        payload: { event, ai: event.match.memberships, dryRunOnly: liveAiUpdateDryRun(env) }
      });
      result.insertedEvents += 1;
      result.dryRunEvents += 1;
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

function liveAiUpdateDryRun(env) {
  return String(env.X_LIVE_AI_UPDATE_DRY_RUN || "true").toLowerCase() !== "false";
}

function maxEventAgeSeconds(env) {
  return clamp(Number(env.MAX_EVENT_AGE_SECONDS || 1800), 30, 1800);
}

function minLiveAiConfidenceMove(env) {
  return clamp(Number(env.MIN_LIVE_AI_CONFIDENCE_MOVE || 10), 5, 30);
}

function maxPostsPerRun(env) {
  return clamp(Number(env.MAX_POSTS_PER_RUN || 10), 1, 15);
}

function pendingRetrySeconds(env) {
  return clamp(Number(env.PENDING_RETRY_SECONDS || 90), 30, 600);
}

function eligibleSections(env) {
  const raw = String(env.ELIGIBLE_SECTIONS || DEFAULT_BOARD_HIT_SECTIONS.join(","));
  return raw.split(",").map(item => item.trim().toUpperCase()).filter(Boolean);
}

function liveAiUpdateSections(env) {
  const raw = String(env.LIVE_AI_UPDATE_SECTIONS || DEFAULT_LIVE_AI_UPDATE_SECTIONS.join(","));
  return raw.split(",").map(item => item.trim().toUpperCase()).filter(Boolean);
}

function retryableDuplicate(row, env = {}) {
  const status = String(row?.status || "").toLowerCase();
  if (["failed", "dry_run", "skipped"].includes(status)) return true;
  if (status === "posted") return !row?.x_post_id;
  if (status !== "pending") return false;

  const createdMs = Date.parse(row?.created_at || "");
  if (!Number.isFinite(createdMs)) return false;
  return Date.now() - createdMs > pendingRetrySeconds(env) * 1000;
}

function eventPatch(row) {
  const { event_key, ...patch } = row;
  return patch;
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

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { "accept": "application/json", ...headers }
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
  return getJson(
    env.AI_SAYS_URL || "https://www.thesliplab.com/data/content/x_live_ai_board.json",
    { "x-member-data-service-key": env.SUPABASE_SERVICE_ROLE_KEY }
  );
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
        name,
        confidence: confidencePercent(player),
        aiScore: confidencePercent(player)
      };
      if (playerId) mapPush(byId, playerId, entry);
      if (name) mapPush(byName, normalizeName(name), entry);
    }
  }

  return { byId, byName };
}

function confidencePercent(player) {
  const raw = Number(player?.confidence ?? player?.aiScore ?? player?.score ?? player?.card?.score);
  if (!Number.isFinite(raw)) return 50;
  if (raw <= 1) return Math.round(raw * 100);
  return Math.round(clamp(raw, 0, 100));
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
      playKey: playKey(game.gamePk, play, batter),
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

function liveAiUpdateEvents({ date, game, feed, aiIndex, maxAgeSeconds, minConfidenceMove }) {
  const allPlays = feed?.liveData?.plays?.allPlays || [];
  const now = Date.now();
  const byPlayer = new Map();

  for (const play of allPlays) {
    const pitch = lastPitch(play);
    const hitData = pitch?.hitData || {};
    const exitVelocity = rounded(hitData?.launchSpeed, 1);
    if (!Number.isFinite(exitVelocity) || exitVelocity < HARD_HIT_MPH) continue;

    const batter = play?.matchup?.batter || {};
    const player = batter?.fullName || "";
    const playerId = batter?.id ?? null;
    const probe = { playerId, player };
    const match = matchAi(probe, aiIndex);
    if (!match) continue;

    const endTime = play?.about?.endTime || play?.about?.startTime || "";
    const endMs = Date.parse(endTime);
    if (!Number.isFinite(endMs)) continue;

    const row = {
      date,
      gamePk: game.gamePk,
      playId: play?.about?.atBatIndex ?? null,
      playerId,
      player,
      pitcherId: play?.matchup?.pitcher?.id ?? null,
      pitcher: play?.matchup?.pitcher?.fullName || "",
      game: gameLabel(feed, game),
      inning: inningLabel(play),
      exitVelocity,
      launchAngle: rounded(hitData?.launchAngle, 0),
      distance: rounded(hitData?.totalDistance, 0),
      event: play?.result?.event || "",
      eventType: play?.result?.eventType || "",
      description: play?.result?.description || "",
      endTime,
      endMs,
      match
    };
    const key = String(playerId || normalizeName(player));
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key).push(row);
  }

  const updates = [];
  for (const hardHits of byPlayer.values()) {
    hardHits.sort((a, b) => a.endMs - b.endMs);
    const latest = hardHits[hardHits.length - 1];
    if (!latest || now - latest.endMs < 0 || now - latest.endMs > maxAgeSeconds * 1000) continue;
    if (hardHits.length < 2) continue;

    const maxExitVelocity = Math.max(...hardHits.map(item => item.exitVelocity));
    if (maxExitVelocity < PREMIUM_HARD_HIT_MPH) continue;

    const baseConfidence = Math.max(...latest.match.memberships.map(item => item.confidence || 0), latest.match.primary.confidence || 0);
    const liveConfidence = liveConfidenceAfterContact(baseConfidence, hardHits);
    const confidenceMove = liveConfidence - baseConfidence;
    if (confidenceMove < minConfidenceMove) continue;

    updates.push({
      ...latest,
      eventType: "live_ai_update",
      hardHitCount: hardHits.length,
      maxExitVelocity: rounded(maxExitVelocity, 1),
      baseConfidence,
      liveConfidence,
      confidenceMove,
      hardHits: hardHits.map(item => ({
        playId: item.playId,
        inning: item.inning,
        exitVelocity: item.exitVelocity,
        launchAngle: item.launchAngle,
        distance: item.distance,
        event: item.event,
        endTime: item.endTime
      })),
      latest
    });
  }

  return updates.sort((a, b) => b.confidenceMove - a.confidenceMove || b.maxExitVelocity - a.maxExitVelocity);
}

function liveConfidenceAfterContact(baseConfidence, hardHits) {
  const maxExitVelocity = Math.max(...hardHits.map(item => item.exitVelocity));
  const bump =
    Math.min(12, (hardHits.length - 1) * 6) +
    (maxExitVelocity >= PREMIUM_HARD_HIT_MPH ? 4 : 0) +
    Math.min(8, Math.max(0, maxExitVelocity - PREMIUM_HARD_HIT_MPH) * 0.7);
  return Math.min(99, Math.round(baseConfidence + bump));
}

function lastPitch(play) {
  return [...(play?.playEvents || [])].reverse().find(event => event?.isPitch || event?.type === "pitch") || {};
}

function playKey(gamePk, play, batter) {
  return [
    "mlb",
    gamePk,
    play?.about?.atBatIndex ?? play?.about?.endTime ?? "play",
    batter?.id ?? normalizeName(batter?.fullName)
  ].join(":");
}

function eventKey(event, eventType) {
  if (eventType === "live_ai_update") {
    return ["mlb", event.gamePk, event.playerId || normalizeName(event.player), eventType].join(":");
  }
  return [event.playKey, eventType].filter(Boolean).join(":");
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

function buildHomeRunTweet(event, match, eventType) {
  if (eventType === "slip_lab_hit_home_run") {
    const topHit = match.memberships.find(item => PREMIUM_HIT_SECTIONS.has(item.section)) || match.primary;
    const isPremiumHit = PREMIUM_HIT_SECTIONS.has(topHit.section);
    const stats = [
      event.distance ? `${event.distance} ft` : "",
      event.exitVelocity ? `${event.exitVelocity} mph EV` : "",
      event.launchAngle ? `${event.launchAngle}° LA` : ""
    ].filter(Boolean).join(" · ");

    return [
      "🚨 SLIP LAB HIT",
      "",
      isPremiumHit
        ? `Our ${topHit.section} #${topHit.rank} HR pick just left the yard.`
        : "A Slip Lab board pick just left the yard.",
      "",
      event.player,
      `${topHit.section} #${topHit.rank}`,
      stats,
      event.pitcher ? `Off ${event.pitcher}` : "",
      "",
      `Board: ${DEFAULT_BOARD_URL}`
    ].filter(line => line !== "").join("\n").trim();
  }

  const headline = match.primary.section === "LIVE LONGSHOTS"
    ? "🚨 SLIP LAB LONGSHOT HIT"
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

function buildLiveAiUpdateTweet(event) {
  return [
    "📈 LIVE AI UPDATE",
    "",
    `${event.player} is heating up.`,
    "",
    `Confidence: ${event.baseConfidence} → ${event.liveConfidence}`,
    `${event.hardHitCount} hard-hit balls tonight`,
    `Latest: ${event.latest.exitVelocity} mph EV`,
    event.latest.launchAngle ? `${event.latest.launchAngle}° LA` : "",
    "",
    `Watch list: ${DEFAULT_BOARD_URL}`
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

async function supabaseGetDuplicatePlay(env, event, eventTypes) {
  const filters = [
    `game_pk=eq.${encodeURIComponent(event.gamePk)}`,
    `play_id=eq.${encodeURIComponent(String(event.playId))}`,
    `event_type=in.(${eventTypes.map(type => encodeURIComponent(type)).join(",")})`,
    "select=id,event_key,status,x_post_id,event_type,player_name,created_at,posted_at",
    "limit=1"
  ];
  if (event.playerId) {
    filters.push(`player_id=eq.${encodeURIComponent(event.playerId)}`);
  } else {
    filters.push(`player_name=eq.${encodeURIComponent(event.player)}`);
  }

  const response = await fetch(supabaseUrl(env, `${SUPABASE_TABLE}?${filters.join("&")}`), {
    headers: supabaseHeaders(env)
  });
  if (!response.ok) throw new Error(`Supabase duplicate lookup failed ${response.status}: ${await response.text()}`);
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
    "hardHitPlayersScanned",
    "matchedEvents",
    "insertedEvents",
    "postedEvents",
    "dryRunEvents",
    "skippedEvents",
    "failedEvents"
  ]) {
    target[key] += result[key] || 0;
  }
  for (const [status, count] of Object.entries(result.duplicateStatusCounts || {})) {
    target.duplicateStatusCounts[status] = (target.duplicateStatusCounts[status] || 0) + count;
  }
  target.duplicateSamples.push(...(result.duplicateSamples || []).slice(0, 8 - target.duplicateSamples.length));
}

function incrementDuplicateStatus(result, row) {
  const status = String(row?.status || "unknown").toLowerCase() || "unknown";
  result.duplicateStatusCounts[status] = (result.duplicateStatusCounts[status] || 0) + 1;
  if (result.duplicateSamples.length < 8) {
    result.duplicateSamples.push({
      player: row?.player_name || "",
      status,
      eventType: row?.event_type || "",
      xPostId: row?.x_post_id || null
    });
  }
}
