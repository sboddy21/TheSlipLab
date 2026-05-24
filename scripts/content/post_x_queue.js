import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";

dotenv.config();

const ROOT = process.cwd();

const QUEUE_FILE = path.join(
  ROOT,
  "website/data/content/x_daily_queue.json"
);

const LOG_FILE = path.join(
  ROOT,
  "logs/x_post_history.json"
);

const DRY_RUN =
  String(process.env.X_DRY_RUN || "true").toLowerCase() === "true";

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
    throw new Error(`Missing env variable: ${name}`);
  }

  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function getClient() {
  return new TwitterApi({
    appKey: requireEnv("X_API_KEY"),
    appSecret: requireEnv("X_API_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_SECRET")
  });
}

async function publishPost(client, post) {
  if (DRY_RUN) {
    console.log("DRY RUN");
    console.log(post.text);

    return {
      id: `dry_run_${post.id}`
    };
  }

  const tweet = await client.v2.tweet({
    text: post.text
  });

  return {
    id: tweet?.data?.id || null
  };
}

async function main() {
  const queueData = readJson(QUEUE_FILE, { posts: [] });

  const history = readJson(LOG_FILE, {
    posted_ids: [],
    posts: []
  });

  const posts = Array.isArray(queueData.posts)
    ? queueData.posts
    : [];

  if (!posts.length) {
    console.log("No queued posts.");
    return;
  }

  const client = getClient();

  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const post of posts) {
    if (!post?.id) {
      skipped++;
      continue;
    }

    if (history.posted_ids.includes(post.id)) {
      console.log(`SKIP DUPLICATE: ${post.id}`);
      skipped++;
      continue;
    }

    try {
      const result = await publishPost(client, post);

      post.posted = !DRY_RUN;
      post.status = DRY_RUN ? "dry_run" : "posted";
      post.posted_at = nowIso();
      post.x_post_id = result.id;

      history.posted_ids.push(post.id);

      history.posts.push({
        id: post.id,
        type: post.type,
        text: post.text,
        posted_at: post.posted_at,
        x_post_id: post.x_post_id,
        dry_run: DRY_RUN
      });

      posted++;

      console.log(
        `${DRY_RUN ? "DRY RUN OK" : "POSTED"}: ${post.id}`
      );
    } catch (error) {
      failed++;

      console.error(`FAILED: ${post.id}`);
      console.error(error.message);
    }
  }

  history.updated_at = nowIso();

  writeJson(LOG_FILE, history);
  writeJson(QUEUE_FILE, queueData);

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
