const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DC_FILE = path.join(ROOT, "website/data/hr_decision_center.json");
const POOL_FILE = path.join(ROOT, "website/data/mlb_player_pool.json");
const HR_FILE = path.join(ROOT, "website/data/mlb_home_runs.json");
const PROBABILITY_FILE = path.join(ROOT, "website/data/hr_probability_tracking.json");
const OUT_FILE = path.join(ROOT, "website/data/hr_ai_breakdowns.json");

function readJson(file, fallback){
  try { return JSON.parse(fs.readFileSync(file,"utf8")); }
  catch { return fallback; }
}

function arr(x){
  if (Array.isArray(x)) return x;
  return x?.players || x?.allPlayers || x?.rows || x?.data || [];
}

function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function probabilityPercent(v){
  const value = num(v);
  return value > 0 && value <= 1 ? value * 100 : value;
}

function clean(v){
  return String(v || "").trim();
}

function key(v){
  return clean(v).toLowerCase();
}

function playerName(r){
  return clean(r.player || r.name || r.batter || r.fullName);
}

function getScore(r){
  return Math.max(
    num(r.aiDailyScore),
    num(r.dailyContextScore),
    num(r.hrConfidence) > 1 ? num(r.hrConfidence) * 4 : num(r.hrConfidence) * 100,
    probabilityPercent(r.realHrProbability),
    probabilityPercent(r.hrProbability),
    num(r.score),
    num(r.powerScore) * .8,
    num(r.pitcherRisk) * .75,
    28
  );
}

function getConfidence(score, r){
  const canonicalProbability = probabilityPercent(r.realHrProbability);
  if (canonicalProbability > 0) return canonicalProbability;

  const direct = Math.max(
    num(r.hrConfidence),
    probabilityPercent(r.hrProbability)
  );

  if (direct > 0) return direct > 1 ? direct : direct * 100;

  return Math.max(4.5, Math.min(22, 4 + score * .18));
}

function grade(score, rank){
  if (rank === 1) return "A+";
  if (rank <= 7) return "A";
  if (rank <= 56) return "B+";
  return "B";
}

function sectionHit(dc, player, sectionName){
  const rows = dc?.sections?.[sectionName] || [];
  const name = key(player);
  return rows.some(r => key(playerName(r)) === name);
}

function reasonPack(r, conf){
  const reasons = [];

  reasons.push(`${conf.toFixed(1)}% model HR confidence`);

  const power = num(r.powerScore || r.hrPowerScore || r.batterPower || r.valueScore);
  const pitcher = num(r.pitcherRisk || r.pitcherVulnerability || r.pitcherScore);
  const pitch = num(r.pitchTypeDestructionScore || r.pitchTypeEdge || r.pitchEdge);
  const bullpen = num(r.bullpenInheritanceScore || r.bullpen || r.bullpenBoost);
  const weather = num(r.weatherScore || r.weatherCarryScore || r.pullWindHrScore || r.weather);

  if (power >= 75) reasons.push("Elite power profile");
  else if (power >= 55) reasons.push("Above-average power profile");
  else reasons.push("Strong model profile");

  if (pitcher >= 90) reasons.push("Extremely vulnerable opposing pitcher");
  else if (pitcher >= 75) reasons.push("Pitcher vulnerability is one of the strongest daily signals");
  else if (pitcher >= 55) reasons.push("Positive pitcher vulnerability on today's slate");

  if (pitch >= 55) reasons.push("Pitch mix lines up with the hitter damage profile");
  if (weather >= 55) reasons.push("Weather environment supports carry");
  if (bullpen >= 45) reasons.push("Bullpen path adds late-game HR upside");

  return reasons.slice(0,5);
}

function buildExplanationScores(info){
  const txt = (info.reasons || []).join(" ").toLowerCase();

  let power = 70;
  let matchup = 70;
  let environment = 65;

  if (txt.includes("elite power")) power = 95;
  else if (txt.includes("above-average power")) power = 82;
  else if (txt.includes("strong model")) power = 75;

  if (txt.includes("extremely vulnerable")) matchup = 96;
  else if (txt.includes("strongest daily signals")) matchup = 90;
  else if (txt.includes("positive pitcher")) matchup = 82;

  if (txt.includes("weather")) environment = 92;
  else if (txt.includes("bullpen")) environment = 88;

  return {
    power,
    matchup,
    environment,
    certainty: Math.round(info.score || 0)
  };
}


function buildAnalystTake(info){
  const reasons = info.reasons || [];
  const conf = info.confidence ? `${info.confidence}%` : "model-backed";
  const game = `${info.team || "his team"} vs ${info.opponent || "opponent"}`;
  const pitcher = info.pitcher || "the expected starter";

  const mainReasons = reasons
    .filter(r => !String(r).includes("%"))
    .slice(0,3)
    .join(", ");

  if (info.grade === "A+" || info.grade === "A") {
    return `${info.player} is one of the model's strongest HR targets in ${game}, carrying a ${info.grade} grade with ${conf} HR confidence against ${pitcher}. The profile is driven by ${mainReasons || "a strong blend of power, matchup, and slate context"}, giving him one of the cleaner AI-backed paths on the board.`;
  }

  if (info.grade === "B+") {
    return `${info.player} checks in as a strong secondary AI target in ${game}. The grade is not built on one signal alone — ${mainReasons || "the matchup, power profile, and game context"} all keep him firmly in the mix against ${pitcher}.`;
  }

  return `${info.player} lands in the AI watch range for ${game}. The model sees enough in the matchup against ${pitcher} to keep him on the radar, but the profile is more of a lower-priority HR lean than a core target.`;
}

const dc = readJson(DC_FILE,{});
const pool = readJson(POOL_FILE,[]);
const hrRows = arr(readJson(HR_FILE, []));
const probabilityRows = arr(readJson(PROBABILITY_FILE, []));
const poolRows = arr(pool);

const poolByName = new Map();
for (const p of poolRows) {
  const n = key(playerName(p));
  if (n) poolByName.set(n, p);
}

const hrByName = new Map();
for (const h of hrRows) {
  const n = key(playerName(h));
  if (n) hrByName.set(n, h);
}

const probabilityByName = new Map();
for (const probability of probabilityRows) {
  const n = key(playerName(probability));
  if (n) probabilityByName.set(n, probability);
}

const dcByName = new Map();
for (const d of arr(dc)) {
  const n = key(playerName(d));
  if (n) dcByName.set(n, d);
}

function liveContextFor(player){
  const k = key(player);
  return {
    hr: hrByName.get(k) || {},
    dc: dcByName.get(k) || {},
    pool: poolByName.get(k) || {}
  };
}

function bestLivePitch(ctx){
  return clean(
    ctx.hr.pitchTypeDestructionPitch ||
    ctx.hr.bestPitch ||
    ctx.dc.bestPitch ||
    "Live pitch edge unavailable"
  );
}

function bestLiveZone(ctx){
  const zoneOverlap = num(ctx.dc.zoneOverlap);
  const hotZones = num(ctx.dc.hotZoneCount);
  const leak = num(ctx.dc.pitcherLeak);

  if (zoneOverlap || hotZones || leak) {
    return `${Math.round(zoneOverlap)} overlap / ${hotZones} hot zones / ${Math.round(leak)} pitcher leak`;
  }

  return "Live zone edge unavailable";
}

function projectedDistance(ctx){
  const launch = num(ctx.hr.launchHrProfileScore);
  const ceiling = num(ctx.hr.multiHrCeilingScore);
  const pullWind = num(ctx.hr.pullWindHrScore);
  const volatility = num(ctx.hr.hrVolatilityScore);

  const distance = 382 + launch * 0.18 + ceiling * 0.14 + pullWind * 0.10 + volatility * 0.08;
  return Math.round(Math.max(380, Math.min(455, distance)));
}

function liveBreakdownScores(ctx, fallback){
  const hr = ctx.hr || {};
  const dc = ctx.dc || {};
  const fb = fallback || {};

  return {
    power: Math.round(num(fb.power) || num(dc.powerScore) || num(hr.truePowerScore) || num(hr.hrPowerIndex) || 0),
    matchup: Math.round(num(fb.matchup) || num(dc.pitcherRisk) || num(hr.pitchTypeDestructionScore) || 0),
    environment: Math.round(num(fb.environment) || Math.max(num(hr.pullWindHrScore), num(hr.bullpenInheritanceScore), num(dc.weather), num(dc.bullpen))),
    bullpen: Math.round(num(hr.bullpenInheritanceScore) || num(dc.bullpen) || 0),
    pitch: Math.round(num(hr.pitchTypeDestructionScore) || num(dc.pitchEdge) || 0),
    launch: Math.round(num(hr.launchHrProfileScore) || 0),
    ceiling: Math.round(num(hr.multiHrCeilingScore) || 0),
    volatility: Math.round(num(hr.hrVolatilityScore) || num(fb.certainty) || 0),
    zone: Math.round(num(dc.zoneOverlap) || 0)
  };
}

const rows = [];

if (Array.isArray(dc.allPlayers)) rows.push(...dc.allPlayers);

if (dc.sections && typeof dc.sections === "object") {
  for (const section of Object.values(dc.sections)) {
    if (Array.isArray(section)) rows.push(...section);
  }
}

const existing = new Set(rows.map(r => key(playerName(r))));
for (const p of poolRows) {
  const name = key(playerName(p));
  if (!name || existing.has(name)) continue;
  rows.push(p);
}

const map = new Map();

for (const r of rows) {
  const player = playerName(r);
  if (!player) continue;

  const probability = probabilityByName.get(key(player)) || {};
  const current = {
    ...r,
    realHrProbability: probability.realHrProbability
  };
  const score = getScore(current);
  const conf = getConfidence(score, current);

  const info = {
    player,
    playerId: r.playerId || r.id || r.mlbId || "",
    team: r.team || r.Team || "",
    opponent: r.opponent || r.opp || r.Opponent || "",
    pitcher: r.pitcher || r.opposingPitcher || r.probablePitcher || "TBD",
    score: Number(score.toFixed(1)),
    grade: "B",
    confidence: Number(conf.toFixed(1)),
    title: "Slip Lab AI Breakdown",
    reasons: reasonPack(current, conf)
  };

  info.summary = `The AI model gives ${info.player} a strong HR profile against ${info.pitcher}. ${info.reasons.slice(1,4).join(". ")}.`;
  info.matchupReason = info.reasons.find(x => /pitch|power|confidence/i.test(x)) || "Strong matchup profile";
  info.pitcherReason = info.reasons.find(x => /pitcher|bullpen/i.test(x)) || "Pitcher profile reviewed";
  info.environmentReason = info.reasons.find(x => /weather|bullpen|carry/i.test(x)) || "Run environment reviewed";

  const old = map.get(key(player));
  if (!old || info.score > old.score) map.set(key(player), info);
}

const sorted = [...map.values()].sort((a,b)=>b.score-a.score);

sorted.forEach((info, i) => {
  const rank = i + 1;
  info.rank = rank;
  info.grade = grade(info.score, rank);

  info.consensus = [];
  if (sectionHit(dc, info.player, "bestPicks")) info.consensus.push("🔥 AI + Best Pick");
  if (sectionHit(dc, info.player, "bestValue")) info.consensus.push("💰 AI + Best Value");
  if (sectionHit(dc, info.player, "dueForHr")) info.consensus.push("⏳ AI + Due List");
  if (sectionHit(dc, info.player, "weatherCarry")) info.consensus.push("🌪 AI + Weather");
  if (sectionHit(dc, info.player, "pitchTypeEdges")) info.consensus.push("🧬 AI + Pitch Edge");
  if (sectionHit(dc, info.player, "bullpenBoosts")) info.consensus.push("💣 AI + Bullpen");

  let consensusScore = 0;
  if (sectionHit(dc, info.player, "bestPicks")) consensusScore += 20;
  if (sectionHit(dc, info.player, "bestValue")) consensusScore += 15;
  if (sectionHit(dc, info.player, "dueForHr")) consensusScore += 15;
  if (sectionHit(dc, info.player, "weatherCarry")) consensusScore += 15;
  if (sectionHit(dc, info.player, "pitchTypeEdges")) consensusScore += 15;
  if (sectionHit(dc, info.player, "bullpenBoosts")) consensusScore += 20;

  info.consensusScore = Math.min(100, consensusScore);
  info.agreementCount = info.consensus.length;

  info.badges = [];
  if (rank === 1) info.badges.push("🧠 AI #1");
  else if (rank <= 5) info.badges.push(`🧠 AI #${rank}`);
  if (info.consensus.length >= 3) info.badges.push("⚡ Triple Consensus");
  if ((info.reasons || []).join(" ").toLowerCase().includes("power")) info.badges.push("🔥 Power Fit");
  if ((info.reasons || []).join(" ").toLowerCase().includes("pitcher")) info.badges.push("🎯 Pitcher Leak");
  if ((info.reasons || []).join(" ").toLowerCase().includes("bullpen")) info.badges.push("💣 HR Upside");
  if ((info.reasons || []).join(" ").toLowerCase().includes("pitch mix")) info.badges.push("🧬 Pitch Mix Edge");

  const poolFix = poolByName.get(key(info.player)) || {};

  if (!info.playerId) {
    info.playerId =
      poolFix.playerId ||
      poolFix.mlbId ||
      poolFix.mlbID ||
      poolFix.id ||
      "";
  }

  if (!info.headshot && info.playerId) {
    info.headshot = `https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best/v1/people/${info.playerId}/headshot/67/current`;
  }

  if (!info.team && poolFix.team) info.team = poolFix.team;
  if (!info.opponent && poolFix.opponent) info.opponent = poolFix.opponent;

  const ctx = liveContextFor(info.player);
  const existingScores = buildExplanationScores(info);
  const liveScores = liveBreakdownScores(ctx, existingScores);

  info.bestPitch = bestLivePitch(ctx);
  info.expectedPitch = info.bestPitch;
  info.expectedZone = bestLiveZone(ctx);
  info.projectedDistance = projectedDistance(ctx);

  info.liveModelSignals = {
    hrConfidence: num(ctx.hr.hrConfidence || ctx.dc.hrConfidence),
    pitchTypeDestructionScore: num(ctx.hr.pitchTypeDestructionScore),
    pullWindHrScore: num(ctx.hr.pullWindHrScore),
    launchHrProfileScore: num(ctx.hr.launchHrProfileScore),
    bullpenInheritanceScore: num(ctx.hr.bullpenInheritanceScore),
    multiHrCeilingScore: num(ctx.hr.multiHrCeilingScore),
    hrVolatilityScore: num(ctx.hr.hrVolatilityScore),
    zoneOverlap: num(ctx.dc.zoneOverlap),
    hotZoneCount: num(ctx.dc.hotZoneCount),
    pitcherLeak: num(ctx.dc.pitcherLeak)
  };

  info.explanationScores = {
    ...existingScores,
    ...liveScores,
    certainty: Math.round(num(ctx.hr.score || info.score || existingScores.certainty))
  };

  info.analystTake = buildAnalystTake(info);
  info.cardTake = info.analystTake;
});

const out = {
  updatedAt: new Date().toISOString(),
  source: "hr_decision_center.json + mlb_player_pool.json + hr_probability_tracking.json",
  count: sorted.length,
  players: Object.fromEntries(sorted.map(p => [p.player, p]))
};

fs.writeFileSync(OUT_FILE, JSON.stringify(out,null,2));

console.log("HR AI BREAKDOWNS COMPLETE");
console.log("Players:", sorted.length);
console.log("Saved:", OUT_FILE);
