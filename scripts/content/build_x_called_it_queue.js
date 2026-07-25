import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const SITE_CONTENT = path.join(DATA, "content");
const EXPORT_CONTENT = path.join(ROOT, "exports", "content");
const RESULTS_FILE = path.join(DATA, "mlb_results.json");
const AI_FILE = path.join(DATA, "ai_2.json");
const HISTORY_FILE = path.join(SITE_CONTENT, "x_post_history.json");
const QUEUE_FILE = path.join(SITE_CONTENT, "x_called_it_queue.json");
const JSON_OUT = path.join(EXPORT_CONTENT, "x_called_it_queue.json");
const TXT_OUT = path.join(EXPORT_CONTENT, "x_called_it_queue.txt");

const SECTION_PRIORITY = [
  "TOP 5",
  "TOP 10",
  "TOP 30",
  "ELITE SMASH",
  "SMASH SPOT",
  "SMASH + PARK",
  "HOMER AI",
  "LIVE LONGSHOTS"
];

const ELIGIBLE_SECTIONS = new Set(SECTION_PRIORITY);
const MAX_NEW_POSTS_PER_RUN = 4;
const MAX_STORED_POSTS = 100;
const BOARD_URL = "https://thesliplab.com/ai-says.html";

fs.mkdirSync(SITE_CONTENT, { recursive: true });
fs.mkdirSync(EXPORT_CONTENT, { recursive: true });

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function easternDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeId(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value, digits = 0) {
  const parsed = number(value);
  if (parsed === null) return null;
  return parsed.toFixed(digits).replace(/\.0+$/, "");
}

function sectionRank(section) {
  const index = SECTION_PRIORITY.indexOf(section);
  return index === -1 ? SECTION_PRIORITY.length : index;
}

function uniqueMemberships(rows) {
  const seen = new Set();
  return rows
    .filter(row => row?.section && ELIGIBLE_SECTIONS.has(row.section))
    .filter(row => {
      const key = `${row.section}:${row.rank}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || Number(a.rank || 999) - Number(b.rank || 999));
}

function addToIndex(index, key, entry) {
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(entry);
}

function buildAiIndex(ai) {
  const byId = new Map();
  const byName = new Map();
  const sections = Array.isArray(ai?.sections) ? ai.sections : [];

  for (const section of sections) {
    const sectionName = String(section?.title || section?.name || section?.category || "").trim().toUpperCase();
    const players = Array.isArray(section?.players)
      ? section.players
      : Array.isArray(section?.items)
        ? section.items
        : [];

    for (const [index, player] of players.entries()) {
      const name = String(player?.name || player?.player || player?.batter || "").trim();
      const playerId = player?.playerId ?? player?.id ?? player?.mlbId ?? null;
      const entry = {
        section: sectionName,
        rank: index + 1,
        playerId: playerId ? String(playerId) : null,
        name,
        aiScore: number(player?.aiScore ?? player?.score ?? player?.hrScore),
        confidence: number(player?.confidence),
        card: player?.card || {},
        tags: Array.isArray(player?.tags) ? player.tags : []
      };

      addToIndex(byId, entry.playerId, entry);
      addToIndex(byName, normalizeName(name), entry);
    }
  }

  return { byId, byName };
}

function eventId(row) {
  const date = row?.date || easternDate();
  const game = row?.gamePk || "game";
  const player = row?.playerId || normalizeName(row?.player || row?.batter);
  const play = row?.playId ?? row?.endTime ?? row?.description ?? "play";
  return safeId(`called_it_${date}_${game}_${player}_${play}`);
}

function postedIds(history) {
  return new Set((Array.isArray(history?.posts) ? history.posts : [])
    .filter(post => post?.status === "posted" && post?.x_post_id)
    .map(post => String(post.id || "")));
}

function previousEventIds(queue) {
  const ids = new Set(Array.isArray(queue?.eventIds) ? queue.eventIds.map(String) : []);
  for (const post of Array.isArray(queue?.posts) ? queue.posts : []) {
    if (post?.id) ids.add(String(post.id));
  }
  return ids;
}

function matchAi(row, index) {
  const idMatches = index.byId.get(String(row?.playerId || "")) || [];
  const nameMatches = index.byName.get(normalizeName(row?.player || row?.batter)) || [];
  const memberships = uniqueMemberships([...idMatches, ...nameMatches]);
  const eligible = memberships.filter(item => ELIGIBLE_SECTIONS.has(item.section));
  return eligible.length ? { memberships: eligible, primary: eligible[0] } : null;
}

function statParts(row) {
  const parts = [];
  const distance = formatNumber(row?.distance, 0);
  const ev = formatNumber(row?.exitVelocity, 1);
  const la = formatNumber(row?.launchAngle, 0);
  if (distance) parts.push(`${distance} ft`);
  if (ev) parts.push(`${ev} mph EV`);
  if (la) parts.push(`${la}° LA`);
  return parts;
}

function tagLine(match) {
  return match.memberships
    .slice(0, 3)
    .map(item => `${item.section} #${item.rank}`)
    .join(" · ");
}

function headline(match) {
  if (match.primary.section === "LIVE LONGSHOTS") return "🚨 SLIP LAB LONGSHOT HIT";
  if (match.primary.section === "TOP 5") return "🚨 TOP 5 HR HIT";
  if (match.primary.section === "TOP 10") return "🚨 TOP 10 HR HIT";
  return "🚨 SLIP LAB CALLED IT";
}

function buildText(row, match) {
  const lines = [
    headline(match),
    "",
    `${row.player || row.batter} just homered.`,
    "",
    `AI Says: ${tagLine(match)}`
  ];

  const game = row.game || [row.team, row.opponent].filter(Boolean).join(" vs ");
  if (game) lines.push(game);
  if (row.inning) lines.push(String(row.inning));

  const stats = statParts(row);
  if (stats.length) lines.push(stats.join(" · "));
  if (row.pitcher) lines.push(`Off ${row.pitcher}`);

  lines.push("", `Board: ${BOARD_URL}`);
  return lines.join("\n").trim();
}

function buildPost(row, match) {
  const id = eventId(row);
  return {
    id,
    date: row.date || easternDate(),
    type: "called_it_home_run",
    slot: "live",
    status: "dry_run",
    dryRun: true,
    scheduled_for_eastern: new Date().toISOString(),
    text: buildText(row, match),
    players: [row.player || row.batter].filter(Boolean),
    event: {
      gamePk: row.gamePk ?? null,
      playId: row.playId ?? null,
      playerId: row.playerId ?? null,
      player: row.player || row.batter || null,
      team: row.team || null,
      opponent: row.opponent || null,
      game: row.game || null,
      inning: row.inning || null,
      pitcher: row.pitcher || null,
      distance: row.distance ?? null,
      exitVelocity: row.exitVelocity ?? null,
      launchAngle: row.launchAngle ?? null,
      endTime: row.endTime || null,
      venueName: row.venueName || null
    },
    ai: {
      primarySection: match.primary.section,
      primaryRank: match.primary.rank,
      sections: match.memberships
    },
    posted: false,
    posted_at: null,
    x_post_id: null,
    created_at: new Date().toISOString()
  };
}

const results = readJson(RESULTS_FILE, {});
const ai = readJson(AI_FILE, {});
const history = readJson(HISTORY_FILE, { posts: [] });
const previousQueue = readJson(QUEUE_FILE, { posts: [], eventIds: [] });

const index = buildAiIndex(ai);
const alreadyPosted = postedIds(history);
const alreadySeen = previousEventIds(previousQueue);
const homeRuns = (Array.isArray(results?.homeRuns) ? results.homeRuns : [])
  .filter(row => row?.category === "home_run" || row?.eventType === "home_run" || /home run/i.test(String(row?.event || "")))
  .sort((a, b) => String(a.endTime || "").localeCompare(String(b.endTime || "")));

const candidates = [];
const seenThisRun = new Set();

for (const row of homeRuns) {
  const id = eventId(row);
  if (alreadyPosted.has(id) || alreadySeen.has(id) || seenThisRun.has(id)) continue;
  const match = matchAi(row, index);
  if (!match) continue;
  candidates.push(buildPost(row, match));
  seenThisRun.add(id);
}

const newPosts = candidates.slice(0, MAX_NEW_POSTS_PER_RUN);
const previousPosts = Array.isArray(previousQueue?.posts) ? previousQueue.posts : [];
const posts = [
  ...previousPosts.filter(post => post?.id && !newPosts.some(newPost => newPost.id === post.id)),
  ...newPosts
].slice(-MAX_STORED_POSTS);
const eventIds = [...new Set([
  ...alreadySeen,
  ...newPosts.map(post => post.id)
])].slice(-500);

const payload = {
  updatedAt: new Date().toISOString(),
  date: results?.date || easternDate(),
  mode: "called_it_home_run_dry_run",
  source: "mlb_results.json verified home runs matched against ai_2.json sections",
  dryRun: true,
  postingEnabled: false,
  emptyReason: newPosts.length ? null : "no_new_called_it_home_runs",
  count: posts.length,
  newCount: newPosts.length,
  maxNewPostsPerRun: MAX_NEW_POSTS_PER_RUN,
  eventIds,
  inputSummary: {
    resultsUpdatedAt: results?.updatedAt || null,
    aiGeneratedAt: ai?.generatedAt || null,
    homeRuns: homeRuns.length,
    matchedNewEvents: newPosts.length,
    storedPosts: posts.length,
    eligibleSections: [...ELIGIBLE_SECTIONS]
  },
  posts
};

writeJson(QUEUE_FILE, payload);
writeJson(JSON_OUT, payload);
fs.writeFileSync(
  TXT_OUT,
  posts.length
    ? posts.map(post => `${post.ai.primarySection} #${post.ai.primaryRank}\n${post.text}`).join("\n\n---\n\n")
    : `No new Slip Lab Called It home-run posts for ${payload.date}.`
);

console.log("THE SLIP LAB CALLED IT QUEUE COMPLETE");
console.log("Date:", payload.date);
console.log("Home runs scanned:", homeRuns.length);
console.log("New dry-run posts queued:", newPosts.length);
console.log("Stored dry-run posts:", posts.length);
if (payload.emptyReason) console.log("Empty reason:", payload.emptyReason);
console.log("Saved:", QUEUE_FILE);
