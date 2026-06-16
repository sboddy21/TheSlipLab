const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const HISTORY_FILE = path.join(ROOT, "website/data/hr_ai_history.json");
const AI_FILE = path.join(ROOT, "website/data/hr_ai_breakdowns.json");
const OUT_FILE = path.join(ROOT, "website/data/hr_ai_movement.json");

function read(file, fallback){
  try { return JSON.parse(fs.readFileSync(file,"utf8")); }
  catch { return fallback; }
}

function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function confidenceFrom(row){
  if (num(row.confidence)) return num(row.confidence);

  const m = String((row.reasons || []).find(x => String(x).includes("%")) || "")
    .match(/([\d.]+)%/);

  return num(m?.[1]);
}

const history = read(HISTORY_FILE, { history: {} });
const ai = read(AI_FILE, { players: {} });

const currentRows = Object.values(ai.players || {});
const currentByName = new Map(
  currentRows.map(p => [String(p.player || "").trim(), p])
);

const risers = [];
const fallers = [];
const stable = [];

for (const current of currentRows) {
  const player = String(current.player || "").trim();
  if (!player) continue;

  const records = Array.isArray(history.history?.[player])
    ? history.history[player]
        .filter(r => Number.isFinite(num(r.rank)) || Number.isFinite(num(r.score)))
        .sort((a,b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0))
    : [];

  const latest = {
    timestamp: new Date().toISOString(),
    score: num(current.score),
    rank: num(current.rank),
    grade: current.grade || "B"
  };

  let baseline = null;

  if (records.length >= 2) {
    baseline = records[0];

    for (const rec of records) {
      if (
        num(rec.rank) !== num(latest.rank) ||
        Number(num(rec.score).toFixed(1)) !== Number(num(latest.score).toFixed(1))
      ) {
        baseline = rec;
        break;
      }
    }
  } else if (records.length === 1) {
    baseline = records[0];
  }

  const scoreChange = baseline
    ? Number((num(latest.score) - num(baseline.score)).toFixed(1))
    : 0;

  const rankChange = baseline
    ? num(baseline.rank) - num(latest.rank)
    : 0;

  const item = {
    player,
    playerId: current.playerId || "",
    headshot: current.headshot || "",
    team: current.team || "",
    opponent: current.opponent || "",
    grade: latest.grade,
    currentScore: num(latest.score),
    previousScore: baseline ? num(baseline.score) : num(latest.score),
    scoreChange,
    currentRank: num(latest.rank),
    previousRank: baseline ? num(baseline.rank) : num(latest.rank),
    rankChange,
    confidence: confidenceFrom(current),
    consensusScore: num(current.consensusScore),
    cyclesTracked: records.length
  };

  if (rankChange > 0 || scoreChange > 0) risers.push(item);
  else if (rankChange < 0 || scoreChange < 0) fallers.push(item);
  else {
    stable.push(item);
  }
}

risers.sort((a,b) =>
  (b.rankChange * 8 + b.scoreChange + b.consensusScore * .05) -
  (a.rankChange * 8 + a.scoreChange + a.consensusScore * .05)
);

fallers.sort((a,b) =>
  (a.rankChange * 8 + a.scoreChange) -
  (b.rankChange * 8 + b.scoreChange)
);

stable.sort((a,b) =>
  (b.consensusScore + b.confidence + b.currentScore * .2) -
  (a.consensusScore + a.confidence + a.currentScore * .2)
);

const out = {
  updatedAt: new Date().toISOString(),
  source: "hr_ai_history.json + hr_ai_breakdowns.json",
  currentPlayers: currentRows.length,
  riserCount: risers.length,
  fallerCount: fallers.length,
  stableCount: stable.length,
  risers: risers.slice(0,20),
  fallers: fallers.slice(0,20),
  stable: stable.slice(0,20)
};

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

console.log("AI MOVEMENT COMPLETE");
console.log("Current Players:", out.currentPlayers);
console.log("Risers:", out.risers.length);
console.log("Fallers:", out.fallers.length);
console.log("Stable Watchlist:", out.stable.length);
console.log("Saved:", OUT_FILE);
