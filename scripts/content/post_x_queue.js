import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";

dotenv.config();

const ROOT = process.cwd();
const QUEUE_FILE = path.join(ROOT, "website/data/content/x_daily_queue.json");
const LOG_FILE = path.join(ROOT, "logs/x_post_history.json");

const DRY_RUN = String(process.env.X_DRY_RUN || "true").toLowerCase() === "true";

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env value: ${name}`);
  }
  return value;
}

function getClient() {
  return new TwitterApi({
    appKey: requireEnv("X_API_KEY"),
    appSecret: requireEnv("X_API_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_SECRET")
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeHistory(history) {
  return {
    updatedAt: history.updatedAt || null,
    posted_ids: Array.isArray(history.posted_ids) ? history.posted_ids : [],
    posts: Array.isArray(history.posts) ? history.posts : []
  };
}

async function postItem(client, post) {
  const graphicPath = path.join(ROOT, post.graphic || "");

  if (!fs.existsSync(graphicPath)) {
    throw new Error(`Missing graphic file: ${graphicPath}`);
  }

  if (DRY_RUN) {
    console.log("DRY RUN POST");
    console.log(`Type: ${post.type}`);
    console.log(`Text: ${post.text}`);
    console.log(`Graphic: ${graphicPath}`);
    return {
      dryRun: true,
      tweetId: `dry_run_${post.id}`
    };
  }

  const mediaId = await client.v1.uploadMedia(graphicPath, {
    mimeType: "image/png"
  });

  const tweet = await client.v2.tweet({
    text: post.text,
    media: {
      media_ids: [mediaId]
    }
  });

  return {
    dryRun: false,
    tweetId: tweet?.data?.id || null
  };
}

async function main() {
  const queueData = readJson(QUEUE_FILE, { posts: [] });
  const history = normalizeHistory(readJson(LOG_FILE, {}));

  const posts = Array.isArray(queueData.posts) ? queueData.posts : [];

  if (!posts.length) {
    console.log("No posts in queue.");
    return;
  }

  const client = getClient();

  let postedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const post of posts) {
    if (!post?.id) {
      skippedCount++;
      continue;
    }

    if (history.posted_ids.includes(post.id)) {
      console.log(`SKIP DUPLICATE: ${post.id}`);
      skippedCount++;
      continue;
    }

    try {
      const result = await postItem(client, post);

      post.posted = !DRY_RUN;
      post.status = DRY_RUN ? "dry_run" : "posted";
      post.posted_at = nowIso();
      post.x_post_id = result.tweetId;

      history.posted_ids.push(post.id);
      history.posts.push({
        id: post.id,
        type: post.type,
        text: post.text,
        graphic: post.graphic,
        scheduled_for_eastern: post.scheduled_for_eastern,
        posted_at: post.posted_at,
        x_post_id: post.x_post_id,
        dry_run: DRY_RUN
      });

      history.updatedAt = nowIso();

      postedCount++;
      console.log(`${DRY_RUN ? "DRY RUN OK" : "POSTED"}: ${post.id}`);
    } catch (error) {
      failedCount++;
      post.status = "failed";
      post.error = error.message;
      console.error(`FAILED: ${post.id}`);
      console.error(error.message);
    }
  }

  queueData.posts = posts;

  writeJson(QUEUE_FILE, queueData);
  writeJson(LOG_FILE, history);

  console.log("THE SLIP LAB X POST QUEUE COMPLETE");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Posted: ${postedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`History: ${LOG_FILE}`);
}

main().catch(error => {
  console.error("X posting engine failed.");
  console.error(error.message);
  process.exit(1);
});
