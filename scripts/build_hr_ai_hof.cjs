const fs = require("fs");
const path = require("path");
const DATA = path.join(process.cwd(), "website/data");
function read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch { return fallback; } }
function arr(v) { return Array.isArray(v) ? v : []; }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function key(gamePk, playerId) { return `${Number(gamePk)}|${Number(playerId)}`; }

const aiHistory = read("hr_ai_history.json", { history: {} });
const hrHistory = read("hr_results_history.json", { days: [] });
const receipts = Object.values(aiHistory.history || {}).flatMap(arr).filter(row => {
  if (row?.verifiedPregame !== true) return false;
  const snapshot = Date.parse(row.snapshotAt || row.timestamp || "");
  const start = Date.parse(row.gameStartTime || "");
  return Number.isFinite(snapshot) && Number.isFinite(start) && snapshot < start;
});
const receiptMap = new Map(receipts.map(row => [key(row.gamePk, row.playerId), row]));
const hits = [];
let excludedUnverified = 0;
let excludedIncompleteDays = 0;

for (const day of arr(hrHistory.days)) {
  if (day.status !== "final") { excludedIncompleteDays += arr(day.homeRuns).length; continue; }
  for (const hr of arr(day.homeRuns)) {
    const receipt = receiptMap.get(key(hr.gamePk, hr.playerId));
    if (!receipt || receipt.slateDate !== day.date) { excludedUnverified++; continue; }
    hits.push({
      receiptId: receipt.receiptId, verifiedPregame: true, modelVersion: receipt.modelVersion,
      player: receipt.player, playerId: receipt.playerId, headshot: receipt.headshot || "",
      team: hr.team || receipt.team || "", opponent: hr.opponent || receipt.opponent || "", date: day.date,
      gamePk: receipt.gamePk, gameStartTime: receipt.gameStartTime, snapshotAt: receipt.snapshotAt,
      grade: receipt.grade || "Watch", score: num(receipt.score), rank: num(receipt.probabilityRank || receipt.rank),
      probability: receipt.probability, probabilityTier: receipt.probabilityTier || "",
      distance: hr.distance || "", exitVelocity: hr.exitVelocity || "", launchAngle: hr.launchAngle || "",
      pitcher: hr.pitcher || receipt.pitcher || "", pitchType: hr.pitchType || "", tags: arr(receipt.tags), signals: arr(receipt.signals)
    });
  }
}

const bestCalls = hits.filter(x => ["A+", "A"].includes(String(x.grade))).sort((a,b) => num(b.score)-num(a.score)).slice(0,50);
const valueHits = hits.filter(x => String(x.grade) === "B+").sort((a,b) => num(b.score)-num(a.score)).slice(0,50);
const longshots = hits.filter(x => x.probabilityTier === "LONGSHOT").sort((a,b) => num(b.probability)-num(a.probability)).slice(0,50);
const goatMap = new Map();
for (const h of hits) {
  const id = String(h.playerId);
  const current = goatMap.get(id) || { player: h.player, playerId: h.playerId, headshot: h.headshot, count: 0, bestGrade: h.grade, bestScore: 0 };
  current.count++;
  if (num(h.score) > num(current.bestScore)) { current.bestScore = h.score; current.bestGrade = h.grade; }
  goatMap.set(id, current);
}
const goatBoard = [...goatMap.values()].sort((a,b) => b.count-a.count || num(b.bestScore)-num(a.bestScore)).slice(0,50);
const gradeTotals = hits.reduce((acc, h) => { acc[h.grade || "Watch"] = (acc[h.grade || "Watch"] || 0) + 1; return acc; }, {});
const out = {
  updatedAt: new Date().toISOString(), schemaVersion: "2.0",
  source: "verified pregame receipts in hr_ai_history.json + completed days in hr_results_history.json",
  verification: { verifiedReceiptCount: receipts.length, verifiedHitCount: hits.length, excludedUnverified, excludedIncompleteDays, joinKey: ["date", "gamePk", "playerId"] },
  totalAiHits: hits.length, gradeTotals, bestCalls, valueHits, longshots, goatBoard
};
fs.writeFileSync(path.join(DATA, "hr_ai_hof.json"), JSON.stringify(out, null, 2));
console.log("AI HALL OF FAME COMPLETE");
console.log("Verified AI HR Hits:", out.totalAiHits);
console.log("Excluded unverified:", excludedUnverified);
console.log("Saved:", path.join(DATA, "hr_ai_hof.json"));
