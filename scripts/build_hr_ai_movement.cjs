const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const HISTORY_FILE = path.join(ROOT, "website/data/hr_ai_history.json");
const OUT_FILE = path.join(ROOT, "website/data/hr_ai_movement.json");

if (!fs.existsSync(HISTORY_FILE)) {
  console.log("Missing hr_ai_history.json");
  process.exit(1);
}

const history = JSON.parse(
  fs.readFileSync(HISTORY_FILE, "utf8")
);

const risers = [];
const fallers = [];

for (const [player, records] of Object.entries(history.history || {})) {

  if (!Array.isArray(records) || records.length < 2) continue;

  const current = records[records.length - 1];
  const previous = records[records.length - 2];

  const scoreDelta =
    Number(current.score || 0) -
    Number(previous.score || 0);

  const rankDelta =
    Number(previous.rank || 0) -
    Number(current.rank || 0);

  const item = {
    player,
    currentScore: Number(current.score || 0),
    previousScore: Number(previous.score || 0),
    scoreChange: Number(scoreDelta.toFixed(1)),
    currentRank: Number(current.rank || 0),
    previousRank: Number(previous.rank || 0),
    rankChange: rankDelta,
    grade: current.grade || "Watch"
  };

  if (scoreDelta > 0 || rankDelta > 0) {
    risers.push(item);
  }

  if (scoreDelta < 0 || rankDelta < 0) {
    fallers.push(item);
  }
}

risers.sort((a,b) =>
  (b.rankChange * 5 + b.scoreChange) -
  (a.rankChange * 5 + a.scoreChange)
);

fallers.sort((a,b) =>
  (a.rankChange * 5 + a.scoreChange) -
  (b.rankChange * 5 + b.scoreChange)
);

const out = {
  updatedAt: new Date().toISOString(),
  riserCount: risers.length,
  fallerCount: fallers.length,
  risers: risers.slice(0,15),
  fallers: fallers.slice(0,15)
};

fs.writeFileSync(
  OUT_FILE,
  JSON.stringify(out, null, 2)
);

console.log("AI MOVEMENT COMPLETE");
console.log("Risers:", out.risers.length);
console.log("Fallers:", out.fallers.length);
console.log("Saved:", OUT_FILE);
