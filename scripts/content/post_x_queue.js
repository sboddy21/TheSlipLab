import fs from "fs";
import path from "path";

if (process.env.X_DRY_RUN === undefined) {
  try {
    const dotenv = await import("dotenv");
    dotenv.default.config();
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
}

const ROOT = process.cwd();
const QUEUE_FILE = path.join(ROOT, "website/data/content/x_daily_queue.json");
const HISTORY_FILE = path.join(ROOT, "website/data/content/x_post_history.json");

const DRY_RUN = String(process.env.X_DRY_RUN || "true").toLowerCase() === "true";
const MAX_POST_LENGTH = 25_000;
const MAX_QUEUE_AGE_MS = 15 * 60 * 1000;

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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

function scheduledTime(post) {
  return new Date(post.scheduled_for_eastern).getTime();
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function validateQueueFreshness(queue) {
  if (!queue || Array.isArray(queue) || typeof queue !== "object") {
    throw new Error("X queue freshness validation failed: queue metadata is missing");
  }

  if (queue.date !== todayKey()) {
    throw new Error(`X queue freshness validation failed: queue date is ${queue.date || "missing"}; expected ${todayKey()}`);
  }

  const updatedAtMs = Date.parse(queue.updatedAt);
  const ageMs = Date.now() - updatedAtMs;
  if (!Number.isFinite(updatedAtMs) || ageMs < 0 || ageMs > MAX_QUEUE_AGE_MS) {
    throw new Error("X queue freshness validation failed: queue is outside the 15-minute production window");
  }

  const expectedInputs = queue.slot === "closed" ? 1 : queue.slot === "overnight" ? 3 : 5;
  if (queue.inputValidation?.status !== "passed" || !Array.isArray(queue.inputValidation.inputs) || queue.inputValidation.inputs.length !== expectedInputs) {
    throw new Error("X queue freshness validation failed: required live-input validation is missing");
  }
}

function validateQueue(posts) {
  const errors = [];
  const ids = new Set();

  for (const [index, post] of posts.entries()) {
    const label = post?.id || `post ${index + 1}`;

    if (!post || typeof post !== "object") {
      errors.push(`post ${index + 1} is not an object`);
      continue;
    }

    if (typeof post.id !== "string" || !post.id.trim()) {
      errors.push(`post ${index + 1} is missing an ID`);
    } else if (ids.has(post.id)) {
      errors.push(`${label} has a duplicate ID`);
    } else {
      ids.add(post.id);
    }

    if (typeof post.text !== "string" || !post.text.trim()) {
      errors.push(`${label} has no text`);
    } else if (post.text.length > MAX_POST_LENGTH) {
      errors.push(`${label} has ${post.text.length} characters; maximum is ${MAX_POST_LENGTH}`);
    }

    if (!Number.isFinite(scheduledTime(post))) {
      errors.push(`${label} has an invalid scheduled_for_eastern value`);
    }
  }

  if (errors.length) {
    throw new Error(`X queue preflight failed:\n - ${errors.join("\n - ")}`);
  }
}

async function publish(api, post) {
  if (DRY_RUN) {
    console.log(`DRY RUN OK: ${post.id}`);
    console.log(post.text);
    return null;
  }

  const tweet = await api.v2.tweet({ text: post.text });
  return tweet?.data?.id || null;
}

function recordSuccessfulPost(history, post) {
  const entry = {
    id: post.id,
    date: post.date,
    createdAt: post.created_at || post.createdAt || post.posted_at,
    posted_at: post.posted_at,
    status: "posted",
    x_post_id: post.x_post_id,
    type: post.type,
    slot: post.slot || null,
    text: post.text,
    entities: post.players || post.entities || []
  };

  const previous = Array.isArray(history.posts) ? history.posts : [];
  history.updatedAt = new Date().toISOString();
  history.posts = [
    entry,
    ...previous.filter(item => item.x_post_id !== entry.x_post_id && item.id !== entry.id)
  ].slice(0, 400);
  if (!Array.isArray(history.weather)) history.weather = [];

  writeJson(HISTORY_FILE, history);
}

async function main() {
  const queue = readJson(QUEUE_FILE, []);
  validateQueueFreshness(queue);
  const posts = Array.isArray(queue)
    ? queue
    : Array.isArray(queue.posts)
      ? queue.posts
      : [];

  if (!posts.length) {
    if (!["closed_window", "already_posted"].includes(queue.emptyReason)) {
      throw new Error(`X publish failed: empty queue has no valid no-op reason (${queue.emptyReason || "missing"})`);
    }
    console.log(`No queued posts: ${queue.emptyReason}.`);
    return;
  }

  validateQueue(posts);

  const api = DRY_RUN ? null : await client();
  const history = readJson(HISTORY_FILE, { updatedAt: null, posts: [], weather: [] });
  const postedIds = new Set((Array.isArray(history.posts) ? history.posts : [])
    .filter(item => item.status === "posted" && item.x_post_id)
    .map(item => item.id));

  let published = 0;
  let dryRuns = 0;
  let skipped = 0;
  let failed = 0;

  const ordered = [...posts].sort((a, b) => scheduledTime(a) - scheduledTime(b));

  for (const post of ordered) {
    if (postedIds.has(post.id)) {
      console.log(`SKIP HISTORY MATCH: ${post.id}`);
      skipped++;
      continue;
    }
    if (post.posted === true && post.status === "posted" && post.x_post_id) {
      console.log(`SKIP ALREADY POSTED: ${post.id}`);
      skipped++;
      continue;
    }

    try {
      const tweetId = await publish(api, post);

      if (DRY_RUN) {
        post.posted = false;
        post.status = "dry_run";
        post.tested_at = new Date().toISOString();
        post.posted_at = null;
        post.x_post_id = null;
        dryRuns++;
        console.log(`DRY RUN: ${post.id}`);
      } else {
        if (!tweetId) throw new Error(`X did not return a tweet ID for ${post.id}`);
        post.posted = true;
        post.status = "posted";
        post.posted_at = new Date().toISOString();
        post.x_post_id = tweetId;
        post.error = null;
        published++;
        recordSuccessfulPost(history, post);
        console.log(`POSTED: ${post.id}`);
      }
    } catch (error) {
      failed++;
      post.posted = false;
      post.status = "failed";
      post.error = error.message;
      console.error(`FAILED: ${post.id}`);
      console.error(error.message);
    }

    writeJson(QUEUE_FILE, queue);
  }

  console.log("THE SLIP LAB X POST QUEUE COMPLETE");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Published: ${published}`);
  console.log(`Dry runs: ${dryRuns}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
