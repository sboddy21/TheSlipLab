import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";

const ROOT = process.cwd();
const QUEUE_FILE = path.join(ROOT, "website/data/content/x_daily_queue.json");

const WIDTH = 1600;
const HEIGHT = 900;

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

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function wrapText(ctx, text, maxWidth) {
  const words = clean(text).split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function drawHeader(ctx, post) {
  ctx.fillStyle = "#050805";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  grad.addColorStop(0, "rgba(39,255,106,0.22)");
  grad.addColorStop(0.45, "rgba(39,255,106,0.04)");
  grad.addColorStop(1, "rgba(255,255,255,0.02)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "#27ff6a";
  ctx.font = "900 48px Arial";
  ctx.fillText("THE SLIP LAB", 70, 80);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 78px Arial";
  ctx.fillText(clean(post.type).replaceAll("_", " "), 70, 175);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "500 28px Arial";
  ctx.fillText("Daily MLB model board", 72, 222);

  ctx.fillStyle = "#27ff6a";
  drawRoundedRect(ctx, 1230, 60, 300, 72, 20);

  ctx.fillStyle = "#061006";
  ctx.font = "900 30px Arial";
  ctx.fillText("9:30 AM DROP", 1262, 107);
}

function drawRows(ctx, post) {
  const lines = clean(post.text)
    .split("\n")
    .map(line => clean(line))
    .filter(Boolean)
    .filter(line => !line.includes("THE SLIP LAB"))
    .filter(line => !line.toLowerCase().includes("pick your spots"))
    .filter(line => !line.toLowerCase().includes("value does not"))
    .filter(line => !line.toLowerCase().includes("weather can move"))
    .filter(line => !line.toLowerCase().includes("pitcher attack"))
    .slice(0, 6);

  let y = 285;

  for (const line of lines) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    drawRoundedRect(ctx, 70, y, 1460, 88, 24);

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 34px Arial";

    const wrapped = wrapText(ctx, line, 1350).slice(0, 2);
    let textY = y + 53;

    for (const piece of wrapped) {
      ctx.fillText(piece, 110, textY);
      textY += 38;
    }

    ctx.fillStyle = "#27ff6a";
    ctx.fillRect(84, y + 20, 8, 48);

    y += 105;
  }
}

function drawFooter(ctx) {
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "600 25px Arial";
  ctx.fillText("Lineups matter. I do not blindly bet early.", 70, 830);

  ctx.fillStyle = "#27ff6a";
  ctx.font = "900 28px Arial";
  ctx.fillText("thesliplab.com", 1280, 830);
}

function renderPost(post) {
  const outputPath = path.join(ROOT, post.graphic);
  ensureDir(outputPath);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  drawHeader(ctx, post);
  drawRows(ctx, post);
  drawFooter(ctx);

  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));

  return outputPath;
}

function main() {
  const queue = readJson(QUEUE_FILE, { posts: [] });
  const posts = Array.isArray(queue.posts) ? queue.posts : [];

  if (!posts.length) {
    console.log("No queued posts found. Run build_daily_x_queue.js first.");
    process.exit(0);
  }

  const outputs = [];

  for (const post of posts) {
    outputs.push(renderPost(post));
  }

  console.log("THE SLIP LAB X GRAPHICS COMPLETE");
  console.log(`Graphics rendered: ${outputs.length}`);
  for (const file of outputs) {
    console.log(`Saved: ${file}`);
  }
}

main();
