const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const AI_FILE = path.join(ROOT, "website/data/hr_ai_breakdowns.json");
const OUT_FILE = path.join(ROOT, "website/data/hr_ai_history.json");

const now = new Date();
const cutoff = now.getTime() - (7 * 24 * 60 * 60 * 1000);

const ai = JSON.parse(fs.readFileSync(AI_FILE, "utf8"));

let history = {
  updatedAt: now.toISOString(),
  history: {}
};

if (fs.existsSync(OUT_FILE)) {
  try {
    history = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  } catch {}
}

history.history ||= {};

const players = Object.values(ai.players || {});

players.forEach((player, index) => {

  const key =
    player.player ||
    player.name ||
    `player_${index}`;

  history.history[key] ||= [];

  history.history[key].push({
    timestamp: now.toISOString(),
    score: Number(player.score || 0),
    rank: Number(player.rank || index + 1),
    grade: player.grade || "Watch"
  });

  history.history[key] =
    history.history[key]
      .filter(r => {
        const t = new Date(r.timestamp).getTime();
        return t >= cutoff;
      })
      .slice(-500);

});

history.updatedAt = now.toISOString();

fs.writeFileSync(
  OUT_FILE,
  JSON.stringify(history, null, 2)
);

console.log("AI HISTORY COMPLETE");
console.log("Players:", Object.keys(history.history).length);
console.log("Saved:", OUT_FILE);
