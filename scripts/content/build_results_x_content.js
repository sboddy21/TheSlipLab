import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const RESULTS_FILE = path.join(ROOT, "website", "data", "mlb_results.json");
const OUT_DIR = path.join(ROOT, "exports", "content");
const WEB_OUT_DIR = path.join(ROOT, "website", "data", "content");

const OUT_JSON = path.join(OUT_DIR, "x_results_recap.json");
const OUT_TXT = path.join(OUT_DIR, "x_results_recap.txt");
const WEB_JSON = path.join(WEB_OUT_DIR, "x_results_recap.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function clean(v, fallback = "N/A") {
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

function topBy(rows, field) {
  return [...rows].filter(r => n(r[field]) > 0).sort((a, b) => n(b[field]) - n(a[field]))[0];
}

function buildPosts(results) {
  const rows = results.homeRuns || [];
  const date = clean(results.date);

  const hardest = topBy(rows, "exitVelocity");
  const longest = topBy(rows, "distance");
  const latest = rows[0];

  const posts = [];

  posts.push({
    type: "daily_results_recap",
    text:
`The Slip Lab HR Results Update

${rows.length} HRs tracked today

Hardest Hit:
${hardest ? `${clean(hardest.player)} ${clean(hardest.exitVelocity)} EV` : "Pending"}

Longest HR:
${longest ? `${clean(longest.player)} ${clean(longest.distance)} FT` : "Pending"}

Latest HR:
${latest ? `${clean(latest.player)} vs ${clean(latest.pitcher)}` : "Pending"}

Live board keeps updating as games finish.`
  });

  if (hardest) {
    posts.push({
      type: "hardest_hit_hr",
      text:
`Hardest hit HR on The Slip Lab board so far:

${clean(hardest.player)}
${clean(hardest.team)}
${clean(hardest.exitVelocity)} EV
${clean(hardest.distance)} FT
${clean(hardest.pitchType)} at ${clean(hardest.pitchVelocity)} MPH

That is real damage.`
    });
  }

  if (longest) {
    posts.push({
      type: "longest_hr",
      text:
`Longest HR tracked so far today:

${clean(longest.player)}
${clean(longest.team)}
${clean(longest.distance)} FT
${clean(longest.exitVelocity)} EV
${clean(longest.launchAngle)} LA

The Results page is live tracking every HR.`
    });
  }

  return {
    updatedAt: new Date().toISOString(),
    date,
    count: posts.length,
    posts
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(WEB_OUT_DIR, { recursive: true });

  const results = readJSON(RESULTS_FILE, { homeRuns: [] });
  const out = buildPosts(results);

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  fs.writeFileSync(WEB_JSON, JSON.stringify(out, null, 2));
  fs.writeFileSync(OUT_TXT, out.posts.map(p => p.text).join("\n\n====================\n\n"));

  console.log("RESULTS X CONTENT COMPLETE");
  console.log("Posts:", out.count);
  console.log("Saved:", OUT_JSON);
  console.log("Saved:", OUT_TXT);
  console.log("Saved:", WEB_JSON);
}

main();
