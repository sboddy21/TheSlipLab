import fs from "fs";
import path from "path";

if (process.env.X_DRY_RUN === undefined && process.env.X_SLATE_THREAD_DRY_RUN === undefined) {
  try {
    const dotenv = await import("dotenv");
    dotenv.default.config();
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
}

const ROOT = process.cwd();
const THREAD_FILE = path.join(ROOT, "website", "data", "content", "x_daily_slate_thread.json");
const THREAD_EXPORT = path.join(ROOT, "exports", "content", "x_daily_slate_thread.json");
const THREAD_TEXT = path.join(ROOT, "exports", "content", "x_daily_slate_thread.txt");
const HISTORY_FILE = path.join(ROOT, "website", "data", "content", "x_post_history.json");
const MAX_TWEET_LENGTH = 280;
const MAX_THREAD_AGE_MS = 90 * 60 * 1000;
const DRY_RUN = String(process.env.X_SLATE_THREAD_DRY_RUN ?? process.env.X_DRY_RUN ?? "true").toLowerCase() === "true";
const REPLY_MODE = String(process.env.X_SLATE_THREAD_REPLY_MODE || "chain").toLowerCase();

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

function threadId(thread) {
  return `daily_slate_thread_${thread.date}`;
}

function validateThread(thread) {
  if (!thread || Array.isArray(thread) || typeof thread !== "object") {
    throw new Error("Daily slate thread publish failed: thread payload is missing");
  }

  const expectedDate = easternDate();
  if (thread.date !== expectedDate) {
    throw new Error(`Daily slate thread publish failed: thread date is ${thread.date || "missing"}; expected ${expectedDate}`);
  }

  const updatedAtMs = Date.parse(thread.updatedAt);
  const ageMs = Date.now() - updatedAtMs;
  if (!Number.isFinite(updatedAtMs) || ageMs < 0 || ageMs > MAX_THREAD_AGE_MS) {
    throw new Error("Daily slate thread publish failed: thread is outside the 90-minute production window");
  }

  if (thread.inputValidation?.status !== "passed" || !Array.isArray(thread.inputValidation.inputs) || thread.inputValidation.inputs.length < 4) {
    throw new Error("Daily slate thread publish failed: required live-input validation is missing");
  }

  const posts = Array.isArray(thread.posts) ? thread.posts : [];
  if (posts.length < 2) {
    throw new Error("Daily slate thread publish failed: thread needs an intro and at least one game post");
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
    } else if (post.text.length > MAX_TWEET_LENGTH) {
      errors.push(`${label} has ${post.text.length} characters; maximum is ${MAX_TWEET_LENGTH}`);
    }
    if (index === 0 && post.replyToIndex !== null) {
      errors.push(`${label} should be the root post`);
    }
  }

  if (errors.length) {
    throw new Error(`Daily slate thread preflight failed:\n - ${errors.join("\n - ")}`);
  }
}

function alreadyPostedThread(history, id) {
  return (Array.isArray(history.posts) ? history.posts : [])
    .some(post => post?.id === id && post?.status === "posted" && post?.x_post_id);
}

async function publishPost(api, post, replyToTweetId) {
  if (DRY_RUN) {
    console.log(`DRY RUN OK: ${post.id}`);
    console.log(post.text);
    if (replyToTweetId) console.log(`REPLY TO: ${replyToTweetId}`);
    return `dry_run_${post.index || post.id}`;
  }

  const payload = replyToTweetId
    ? { text: post.text, reply: { in_reply_to_tweet_id: replyToTweetId } }
    : { text: post.text };
  const tweet = await api.v2.tweet(payload);
  const tweetId = tweet?.data?.id;
  if (!tweetId) throw new Error(`X did not return a tweet ID for ${post.id}`);
  return tweetId;
}

function recordThread(history, thread, tweetIds, status) {
  const rootId = tweetIds[0]?.tweetId || null;
  const entry = {
    id: threadId(thread),
    date: thread.date,
    createdAt: thread.updatedAt,
    posted_at: status === "posted" ? new Date().toISOString() : null,
    tested_at: status === "dry_run" ? new Date().toISOString() : null,
    status,
    x_post_id: status === "posted" ? rootId : null,
    type: "daily_slate_thread",
    slot: "morning_slate",
    text: thread.posts[0]?.text || "",
    entities: thread.posts.flatMap(post => post.players || []).slice(0, 50),
    thread: {
      mode: REPLY_MODE,
      postCount: thread.posts.length,
      gameCount: thread.gameCount,
      tweetIds: status === "posted" ? tweetIds : []
    }
  };

  const previous = Array.isArray(history.posts) ? history.posts : [];
  history.updatedAt = new Date().toISOString();
  history.posts = [
    entry,
    ...previous.filter(item => item.id !== entry.id && item.x_post_id !== entry.x_post_id)
  ].slice(0, 400);
  if (!Array.isArray(history.weather)) history.weather = [];
}

function writeThreadOutputs(thread) {
  writeJson(THREAD_FILE, thread);
  writeJson(THREAD_EXPORT, thread);
  fs.writeFileSync(
    THREAD_TEXT,
    thread.posts.map(post => `POST ${post.index}/${thread.posts.length} — ${post.type}\n${post.text}`).join("\n\n---\n\n")
  );
}

async function main() {
  const thread = readJson(THREAD_FILE, null);
  validateThread(thread);

  const history = readJson(HISTORY_FILE, { updatedAt: null, posts: [], weather: [] });
  const id = threadId(thread);
  if (alreadyPostedThread(history, id)) {
    console.log(`SKIP HISTORY MATCH: ${id}`);
    return;
  }

  const api = DRY_RUN ? null : await client();
  const tweetIds = [];
  const idByIndex = new Map();

  for (const post of [...thread.posts].sort((a, b) => Number(a.index || 999) - Number(b.index || 999))) {
    const previousTweetId = tweetIds.length ? tweetIds[tweetIds.length - 1].tweetId : null;
    const rootTweetId = idByIndex.get(1) || null;
    const configuredReplyId = idByIndex.get(Number(post.replyToIndex)) || null;
    const replyToTweetId = post.index === 1
      ? null
      : REPLY_MODE === "root"
        ? (configuredReplyId || rootTweetId)
        : previousTweetId;

    const tweetId = await publishPost(api, post, replyToTweetId);
    tweetIds.push({ index: post.index, id: post.id, tweetId });
    idByIndex.set(Number(post.index), tweetId);
    post.status = DRY_RUN ? "dry_run" : "posted";
    post.posted = !DRY_RUN;
    post.posted_at = DRY_RUN ? null : new Date().toISOString();
    post.x_post_id = DRY_RUN ? null : tweetId;
    post.reply_to_x_post_id = replyToTweetId;
  }

  thread.mode = DRY_RUN ? "dry_run_thread_preview" : "posted_live_thread";
  thread.postingEnabled = !DRY_RUN;
  thread.dryRun = DRY_RUN;
  thread.posted = !DRY_RUN;
  thread.postedAt = DRY_RUN ? null : new Date().toISOString();
  thread.rootXPostId = DRY_RUN ? null : tweetIds[0]?.tweetId || null;
  thread.threadXPostIds = DRY_RUN ? [] : tweetIds;

  recordThread(history, thread, tweetIds, DRY_RUN ? "dry_run" : "posted");
  writeThreadOutputs(thread);
  if (!DRY_RUN) writeJson(HISTORY_FILE, history);

  console.log("THE SLIP LAB DAILY SLATE THREAD POST COMPLETE");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Thread posts: ${thread.posts.length}`);
  console.log(`Root X post ID: ${thread.rootXPostId || "none"}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
