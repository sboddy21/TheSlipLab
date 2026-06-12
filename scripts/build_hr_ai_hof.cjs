const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const AI_FILE =
  path.join(ROOT,"website/data/hr_ai_history.json");

const HR_FILE =
  path.join(ROOT,"website/data/hr_results_history.json");

const OUT_FILE =
  path.join(ROOT,"website/data/hr_ai_hof.json");

function read(file, fallback){
  try{
    return JSON.parse(fs.readFileSync(file,"utf8"));
  }catch{
    return fallback;
  }
}

const aiHistory = read(AI_FILE,{history:{}});
const hrHistory = read(HR_FILE,{days:[]});

const bestCalls = [];
const valueHits = [];
const longshots = [];
const goat = {};

const hrNames = new Set();

for(const day of (hrHistory.days || [])){
  const rows =
    day.rows ||
    day.homeRuns ||
    day.players ||
    [];

  for(const r of rows){
    const player =
      r.player ||
      r.name;

    if(player){
      hrNames.add(String(player).trim());
    }
  }
}

for(const [player, snapshots] of Object.entries(aiHistory.history || {})){

  if(!hrNames.has(player)) continue;

  const best =
    [...snapshots]
      .sort((a,b)=>(b.score||0)-(a.score||0))[0];

  if(!best) continue;

  const hrCount = (hrHistory.days || []).reduce((total, day) => {

    const hrs = day.homeRuns || [];

    return total + hrs.filter(h =>
      String(h.player || "").trim() === player
    ).length;

  }, 0);

  goat[player] = hrCount;

  const row = {
    player,
    grade: best.grade,
    score: best.score,
    rank: best.rank
  };

  if(["A+","A"].includes(best.grade)){
    bestCalls.push(row);
  }
  else if(best.grade === "B+"){
    valueHits.push(row);
  }
  else{
    longshots.push(row);
  }
}

const goatBoard =
  Object.entries(goat)
    .map(([player,count])=>({player,count}))
    .sort((a,b)=>b.count-a.count)
    .slice(0,50);

const out = {
  updatedAt: new Date().toISOString(),
  bestCalls:
    bestCalls
      .sort((a,b)=>b.score-a.score)
      .slice(0,50),

  valueHits:
    valueHits
      .sort((a,b)=>b.score-a.score)
      .slice(0,50),

  longshots:
    longshots
      .sort((a,b)=>b.score-a.score)
      .slice(0,50),

  goatBoard
};

fs.writeFileSync(
  OUT_FILE,
  JSON.stringify(out,null,2)
);

console.log("AI HALL OF FAME COMPLETE");
console.log("Best Calls:", out.bestCalls.length);
console.log("Value Hits:", out.valueHits.length);
console.log("Longshots:", out.longshots.length);
console.log("GOAT Board:", out.goatBoard.length);
console.log("Saved:", OUT_FILE);
