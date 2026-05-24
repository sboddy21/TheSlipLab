import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";

dotenv.config();

const ROOT = process.cwd();
const QUEUE_FILE = path.join(ROOT, "website/data/content/x_daily_queue.json");

const DRY_RUN = String(process.env.X_DRY_RUN || "true").toLowerCase() === "true";

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

function client() {
  return new TwitterApi({
    appKey: requireEnv("X_API_KEY"),
    appSecret: requireEnv("X_API_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_SECRET")
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scheduledTime(post) {
  return new Date(post.scheduled_for_eastern).getTime();
}

async function waitForPostTime(post) {
  const target = scheduledTime(post);
  const now = Date.now();
  const waitMs = target - now;

  if (waitMs > 0) {
    console.log(`Waiting ${Math.ceil(waitMs / 1000)} seconds for ${post.id}`);
    await sleep(waitMs);
  }
}

async function publish(api, post) {
  if (DRY_RUN) {
    console.log(`DRY RUN OK: ${post.id}`);
    console.log(post.text);
    return `dry_run_${post.id}`;
  }

  const tweet = await api.v2.tweet({ text: post.text });
  return tweet?.data?.id || null;
}

async function main() {
  const queue = readJson(QUEUE_FILE, { posts: [] });
  const posts = Array.isArray(queue.posts) ? queue.posts : [];

  if (!posts.length) {
    console.log("No queued posts.");
    return;
  }

  const api = client();

  let posted = 0;
  let skipped = 0;
  let failed = 0;

  const ordered = [...posts].sort((a, b) => scheduledTime(a) - scheduledTime(b));

  for (const post of ordered) {
    if (post.posted || post.x_post_id) {
      console.log(`SKIP ALREADY POSTED: ${post.id}`);
      skipped++;
      continue;
    }

    try {
      await waitForPostTime(post);

      const tweetId = await publish(api, post);

      post.posted = !DRY_RUN;
      post.status = DRY_RUN ? "dry_run" : "posted";
      post.posted_at = new Date().toISOString();
      post.x_post_id = tweetId;

      posted++;
      console.log(`${DRY_RUN ? "DRY RUN" : "POSTED"}: ${post.id}`);
    } catch (error) {
      failed++;
      post.status = "failed";
      post.error = error.message;
      console.error(`FAILED: ${post.id}`);
      console.error(error.message);
    }

    writeJson(QUEUE_FILE, queue);
  }

  console.log("THE SLIP LAB X POST QUEUE COMPLETE");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Posted: ${posted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
