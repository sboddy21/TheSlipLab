const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const AI_HISTORY_FILE = path.join(ROOT, "website/data/hr_ai_history.json");
const AI_CURRENT_FILE = path.join(ROOT, "website/data/hr_ai_breakdowns.json");
const HR_HISTORY_FILE = path.join(ROOT, "website/data/hr_results_history.json");
const OUT_FILE = path.join(ROOT, "website/data/hr_ai_hof.json");

function read(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function key(v){
  return String(v || "").trim().toLowerCase();
}

function dayOf(ts){
  const d = new Date(ts || 0);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10) : "";
}

function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const aiHistory = read(AI_HISTORY_FILE, { history: {} });
const aiCurrent = read(AI_CURRENT_FILE, { players: {} });
const hrHistory = read(HR_HISTORY_FILE, { days: [] });

const currentByName = new Map(
  Object.values(aiCurrent.players || {}).map(p => [key(p.player), p])
);

const hits = [];

for (const day of (hrHistory.days || [])) {
  const date = day.date || "";
  const hrs = day.homeRuns || [];

  for (const hr of hrs) {
    const player = hr.player || hr.name;
    if (!player) continue;

    const snapshots = aiHistory.history?.[player] || [];
    if (!Array.isArray(snapshots) || !snapshots.length) continue;

    const sameDay = snapshots.filter(s => dayOf(s.timestamp) === date);
    const pool = sameDay.length ? sameDay : snapshots;

    const best = [...pool].sort((a,b) => num(b.score) - num(a.score))[0];
    if (!best) continue;

    const current = currentByName.get(key(player)) || {};

    hits.push({
      player,
      playerId: current.playerId || "",
      headshot: current.headshot || "",
      team: hr.team || current.team || "",
      opponent: hr.opponent || current.opponent || "",
      date,
      grade: best.grade || "B",
      score: Number(num(best.score).toFixed(1)),
      rank: num(best.rank),
      distance: hr.distance || "",
      exitVelocity: hr.exitVelocity || "",
      launchAngle: hr.launchAngle || "",
      pitcher: hr.pitcher || current.pitcher || "",
      pitchType: hr.pitchType || ""
    });
  }
}

const bestCalls = hits
  .filter(x => ["A+","A"].includes(String(x.grade)))
  .sort((a,b) => num(b.score) - num(a.score))
  .slice(0,50);

const valueHits = hits
  .filter(x => String(x.grade) === "B+")
  .sort((a,b) => num(b.score) - num(a.score))
  .slice(0,50);

const longshots = hits
  .filter(x => !["A+","A","B+"].includes(String(x.grade)))
  .sort((a,b) => num(b.score) - num(a.score))
  .slice(0,50);

const goatMap = new Map();

for (const h of hits) {
  const existing = goatMap.get(h.player) || {
    player: h.player,
    playerId: h.playerId || "",
    headshot: h.headshot || "",
    count: 0,
    bestGrade: h.grade,
    bestScore: 0
  };

  existing.count += 1;

  if (num(h.score) > num(existing.bestScore)) {
    existing.bestScore = h.score;
    existing.bestGrade = h.grade;
  }

  goatMap.set(h.player, existing);
}

const goatBoard = [...goatMap.values()]
  .sort((a,b) => b.count - a.count || num(b.bestScore) - num(a.bestScore))
  .slice(0,50);

const gradeTotals = hits.reduce((acc,h)=>{
  const g = h.grade || "B";
  acc[g] = (acc[g] || 0) + 1;
  return acc;
}, {});

const out = {
  updatedAt: new Date().toISOString(),
  source: "hr_ai_history.json + hr_results_history.json",
  totalAiHits: hits.length,
  gradeTotals,
  bestCalls,
  valueHits,
  longshots,
  goatBoard
};

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

console.log("AI HALL OF FAME COMPLETE");
console.log("Total AI HR Hits:", out.totalAiHits);
console.log("Best Calls:", out.bestCalls.length);
console.log("Value Hits:", out.valueHits.length);
console.log("Longshots:", out.longshots.length);
console.log("GOAT Board:", out.goatBoard.length);
console.log("Saved:", OUT_FILE);
