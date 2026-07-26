import fs from "fs";
import path from "path";

if (process.env.X_DRY_RUN === undefined && process.env.X_EDGE_POSTS_DRY_RUN === undefined) {
  try {
    const dotenv = await import("dotenv");
    dotenv.default.config();
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
}

const ROOT = process.cwd();
const EDGE_FILE = path.join(ROOT, "website", "data", "content", "x_daily_edge_posts.json");
const EDGE_EXPORT = path.join(ROOT, "exports", "content", "x_daily_edge_posts.json");
const EDGE_TEXT = path.join(ROOT, "exports", "content", "x_daily_edge_posts.txt");
const HISTORY_FILE = path.join(ROOT, "website", "data", "content", "x_post_history.json");
const MAX_POST_LENGTH = 280;
const MAX_EDGE_AGE_MS = 180 * 60 * 1000;
const DRY_RUN = String(process.env.X_EDGE_POSTS_DRY_RUN ?? process.env.X_DRY_RUN ?? "true").toLowerCase() === "true";

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env variable: ${name}`);
  return value;
}

async function client() {
  const { TwitterApi } = await import("twitter-api-v2");
  return new TwitterApi({
    appKey: requireEnv("X_API_KEY"),
    appSecret: requireEnv("X_API_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_SECRET")
  });
}

function easternDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function validatePayload(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("Daily edge posts publish failed: payload is missing");
  }

  const expectedDate = easternDate();
  if (payload.date !== expectedDate) {
    throw new Error(`Daily edge posts publish failed: payload date is ${payload.date || "missing"}; expected ${expectedDate}`);
  }

  const updatedAtMs = Date.parse(payload.updatedAt);
  const ageMs = Date.now() - updatedAtMs;
  if (!Number.isFinite(updatedAtMs) || ageMs < 0 || ageMs > MAX_EDGE_AGE_MS) {
    throw new Error("Daily edge posts publish failed: payload is outside the 180-minute production window");
  }

  if (payload.inputValidation?.status !== "passed" || !Array.isArray(payload.inputValidation.inputs) || payload.inputValidation.inputs.length < 4) {
    throw new Error("Daily edge posts publish failed: required live-input validation is missing");
  }

  const posts = Array.isArray(payload.posts) ? payload.posts : [];
  if (!posts.length) {
    throw new Error("Daily edge posts publish failed: no edge posts were generated");
  }

  const ids = new Set();
  const errors = [];
  for (const [index, post] of posts.entries()) {
    const label = post?.id || `post ${index + 1}`;
    if (!post || typeof post !== "object") {
      errors.push(`post ${index + 1} is not an object`);
      continue;
    }
    if (!post.id || typeof post.id !== "string") {
      errors.push(`post ${index + 1} is missing an ID`);
    } else if (ids.has(post.id)) {
      errors.push(`${label} has a duplicate ID`);
    } else {
      ids.add(post.id);
    }
    if (!post.text || typeof post.text !== "string") {
      errors.push(`${label} has no text`);
    } else if (post.text.length > MAX_POST_LENGTH) {
      errors.push(`${label} has ${post.text.length} characters; maximum is ${MAX_POST_LENGTH}`);
    }
  }

  if (errors.length) {
    throw new Error(`Daily edge posts preflight failed:\n - ${errors.join("\n - ")}`);
  }
}

function alreadyPosted(history, post) {
  return (Array.isArray(history.posts) ? history.posts : [])
    .some(item => item?.id === post.id && item?.status === "posted" && item?.x_post_id);
}

async function publishPost(api, post) {
  if (DRY_RUN) {
    console.log(`DRY RUN OK: ${post.id}`);
    console.log(post.text);
    return `dry_run_${post.id}`;
  }

  const tweet = await api.v2.tweet({ text: post.text });
  const tweetId = tweet?.data?.id;
  if (!tweetId) throw new Error(`X did not return a tweet ID for ${post.id}`);
  return tweetId;
}

function recordPost(history, payload, post, status) {
  const entry = {
    id: post.id,
    date: payload.date,
    createdAt: post.created_at || payload.updatedAt,
    posted_at: status === "posted" ? post.posted_at : null,
    tested_at: status === "dry_run" ? new Date().toISOString() : null,
    status,
    x_post_id: status === "posted" ? post.x_post_id : null,
    type: post.type || "daily_edge_post",
    slot: "daily_edge",
    text: post.text,
    entities: post.players || post.signals?.map(signal => signal.player).filter(Boolean) || [],
    signals: post.signals || [],
    games: post.games || []
  };

  const previous = Array.isArray(history.posts) ? history.posts : [];
  history.posts = [
    entry,
    ...previous.filter(item => item.id !== entry.id && item.x_post_id !== entry.x_post_id)
  ].slice(0, 400);
}

function writeOutputs(payload) {
  writeJson(EDGE_FILE, payload);
  writeJson(EDGE_EXPORT, payload);
  fs.writeFileSync(
    EDGE_TEXT,
    payload.posts.map((post, index) => `POST ${index + 1}/${payload.posts.length} — ${post.type}\n${post.text}`).join("\n\n---\n\n")
  );
}

async function main() {
  const payload = readJson(EDGE_FILE, null);
  validatePayload(payload);

  const history = readJson(HISTORY_FILE, { updatedAt: null, posts: [], weather: [] });
  if (!Array.isArray(history.posts)) history.posts = [];
  if (!Array.isArray(history.weather)) history.weather = [];

  const api = DRY_RUN ? null : await client();
  const posted = [];
  const skipped = [];

  for (const post of payload.posts) {
    if (alreadyPosted(history, post)) {
      post.status = "skipped_history_match";
      post.skipped = true;
      skipped.push(post.id);
      console.log(`SKIP HISTORY MATCH: ${post.id}`);
      continue;
    }

    const tweetId = await publishPost(api, post);
    post.status = DRY_RUN ? "dry_run" : "posted";
    post.dryRun = DRY_RUN;
    post.posted = !DRY_RUN;
    post.posted_at = DRY_RUN ? null : new Date().toISOString();
    post.x_post_id = DRY_RUN ? null : tweetId;
    posted.push({ id: post.id, type: post.type, tweetId });
    recordPost(history, payload, post, DRY_RUN ? "dry_run" : "posted");
  }

  payload.mode = DRY_RUN ? "dry_run_daily_edge_posts" : "posted_live_daily_edge_posts";
  payload.postingEnabled = !DRY_RUN;
  payload.dryRun = DRY_RUN;
  payload.posted = !DRY_RUN && posted.length > 0;
  payload.postedAt = payload.posted ? new Date().toISOString() : null;
  payload.postedCount = DRY_RUN ? 0 : posted.length;
  payload.skippedCount = skipped.length;
  payload.xPostIds = DRY_RUN ? [] : posted;

  history.updatedAt = new Date().toISOString();
  writeOutputs(payload);
  if (!DRY_RUN) writeJson(HISTORY_FILE, history);

  console.log("THE SLIP LAB DAILY EDGE POSTS POST COMPLETE");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Posted: ${posted.length}`);
  console.log(`Skipped: ${skipped.length}`);
  if (!DRY_RUN) {
    for (const item of posted) {
      console.log(`${item.type}: ${item.tweetId}`);
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
