import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const QUEUE_FILE = path.join(ROOT, "website/data/content/x_daily_queue.json");
const REPORT_FILE = path.join(ROOT, "website/data/hr_calibration_report.json");
const GRAPHICS_ROOT = path.join(ROOT, "exports", "content", "graphics");

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

function verifiedGraphicPath(post) {
  const outputPath = path.resolve(ROOT, post.graphic || "");
  if (!outputPath.startsWith(`${GRAPHICS_ROOT}${path.sep}`) || path.extname(outputPath).toLowerCase() !== ".png") {
    throw new Error(`${post.id} has an invalid verified graphic path`);
  }
  return outputPath;
}

function drawVerifiedReport(ctx, post, report) {
  ctx.fillStyle = "#071b31";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "rgba(18,191,126,0.30)");
  gradient.addColorStop(1, "rgba(10,41,70,0.05)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "#9cff36";
  ctx.font = "900 40px Arial";
  ctx.fillText("THE SLIP LAB", 72, 76);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 66px Arial";
  ctx.fillText("VERIFIED DAILY MODEL REPORT", 72, 160);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "600 28px Arial";
  ctx.fillText(`${report.reportDate} • archived before first pitch • final results only`, 74, 207);

  const cards = [
    ["ACTUAL HOME RUNS", report.actualSlateHomeRuns],
    ["MODEL EXPECTED", Number(report.expectedHomeRuns).toFixed(1)],
    ["ACTUAL VS EXPECTED", `${Number(report.actualVsExpected) >= 0 ? "+" : ""}${Number(report.actualVsExpected).toFixed(1)}`],
    ["GAME COVERAGE", `${Number(report.gameCoverage).toFixed(1)}%`]
  ];
  cards.forEach(([label, value], index) => {
    const x = 72 + index * 370;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    drawRoundedRect(ctx, x, 255, 338, 150, 18);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "700 20px Arial";
    ctx.fillText(label, x + 25, 295);
    ctx.fillStyle = index === 2 ? "#ffb34f" : "#9cff36";
    ctx.font = "900 56px Arial";
    ctx.fillText(String(value), x + 25, 370);
  });

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 31px Arial";
  ctx.fillText(`TOP 10: ${report.top10?.hits || 0} HR • ${report.top10?.hitRate ?? 0}% CONVERSION`, 72, 470);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "700 23px Arial";
  ctx.fillText("VERIFIED PREGAME CALLS", 72, 520);

  report.verifiedCalls.slice(0, 3).forEach((call, index) => {
    const y = 545 + index * 82;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    drawRoundedRect(ctx, 72, y, 1456, 65, 14);
    ctx.fillStyle = "#9cff36";
    ctx.font = "900 27px Arial";
    ctx.fillText(call.player, 100, y + 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 23px Arial";
    const probability = Number(call.probability);
    const probabilityLabel = Number.isFinite(probability) ? `${probability.toFixed(1)}%` : "verified probability";
    const detail = `Pregame rank ${call.rank ? `#${call.rank}` : "verified"}  •  ${probabilityLabel}  •  ${call.distance ? `${Math.round(call.distance)} ft` : "HR"}`;
    ctx.fillText(detail, 620, y + 41);
  });

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "600 23px Arial";
  ctx.fillText("Public methodology and complete accountability report", 72, 846);
  ctx.fillStyle = "#9cff36";
  ctx.font = "900 26px Arial";
  ctx.fillText("thesliplab.com/model-report.html", 1115, 846);
}

function renderPost(post, createCanvas) {
  const outputPath = verifiedGraphicPath(post);
  ensureDir(outputPath);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  if (post.graphicType === "verified_model_report") {
    const payload = readJson(REPORT_FILE, {});
    const report = payload.dailyReport;
    if (post.verifiedPregame !== true || post.verifiedResults !== true || report?.status !== "verified"
      || report?.reportDate !== post.reportDate || report?.verification?.latestSnapshotBeforeFirstPitch !== true
      || report?.verification?.resultSlateFinal !== true) {
      throw new Error(`${post.id} cannot render without a matching verified report`);
    }
    drawVerifiedReport(ctx, post, report);
  } else {
    throw new Error(`${post.id} has unsupported graphic type ${post.graphicType || "missing"}`);
  }

  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));

  return outputPath;
}

async function main() {
  const queue = readJson(QUEUE_FILE, { posts: [] });
  const posts = Array.isArray(queue.posts) ? queue.posts.filter(post => post.graphic) : [];

  if (!posts.length) {
    console.log("No queued graphics found.");
    return;
  }

  const { createCanvas } = await import("canvas");
  const outputs = [];

  for (const post of posts) {
    outputs.push(renderPost(post, createCanvas));
  }

  console.log("THE SLIP LAB X GRAPHICS COMPLETE");
  console.log(`Graphics rendered: ${outputs.length}`);
  for (const file of outputs) {
    console.log(`Saved: ${file}`);
  }
}

await main();
