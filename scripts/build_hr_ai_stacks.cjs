const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const AI_FILE = path.join(ROOT, "website/data/hr_ai_breakdowns.json");
const OUT_FILE = path.join(ROOT, "website/data/hr_ai_stacks.json");

const ai = JSON.parse(fs.readFileSync(AI_FILE, "utf8"));

const players = Object.values(ai.players || {});
const teams = {};

for (const p of players) {
  const team = p.team || "Unknown";

  if (!teams[team]) teams[team] = [];

  teams[team].push(p);
}

const stacks = Object.entries(teams)
  .map(([team, rows]) => {

    const top = rows
      .sort((a,b)=>Number(b.score||0)-Number(a.score||0))
      .slice(0,3);

    const avgConfidence =
      top.reduce((s,r)=>{
        const m = String(
          (r.reasons || []).find(x=>x.includes("%")) || ""
        ).match(/([\d.]+)%/);
        return s + Number(m?.[1] || 0);
      },0) / Math.max(top.length,1);

    const consensus =
      top.reduce((s,r)=>s + Number(r.consensusScore || 0),0) /
      Math.max(top.length,1);

    const aiScore =
      top.reduce((s,r)=>s + Number(r.score || 0),0) /
      Math.max(top.length,1);

    const elite =
      top.filter(r=>["A+","A"].includes(String(r.grade))).length;

    const topPlayer = Math.max(
      ...top.map(r => Number(r.score || 0))
    );

    const aPlus =
      top.filter(r => String(r.grade) === "A+").length;

    const aGrades =
      top.filter(r => ["A+","A"].includes(String(r.grade))).length;

    const stackScore =
      Math.round(
        aiScore * 0.35 +
        consensus * 0.25 +
        avgConfidence * 1.00 +
        topPlayer * 0.20 +
        aPlus * 25 +
        aGrades * 12
      );

    return {
      team,
      stackScore,
      consensusScore: Math.round(consensus),
      avgConfidence: Number(avgConfidence.toFixed(1)),
      eliteCount: elite,
      players: top
    };
  })
  .sort((a,b)=>b.stackScore-a.stackScore)
  .slice(0,10);

fs.writeFileSync(
  OUT_FILE,
  JSON.stringify({
    updatedAt: new Date().toISOString(),
    stackCount: stacks.length,
    stacks
  }, null, 2)
);

console.log("AI STACK FINDER COMPLETE");
console.log("Stacks:", stacks.length);
console.log("Saved:", OUT_FILE);
