const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DC_FILE = path.join(ROOT, "website/data/hr_decision_center.json");
const POOL_FILE = path.join(ROOT, "website/data/mlb_player_pool.json");
const OUT_FILE = path.join(ROOT, "website/data/hr_ai_breakdowns.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function grade(score, rank = 999) {
  if (rank === 1 && score >= 78) return "A+";
  if (rank <= 5 && score >= 68) return "A";
  if (rank <= 20 && score >= 58) return "B+";
  if (score >= 48) return "B";
  return "B";
}

function pct(v) {
  const n = num(v);
  if (!n) return null;
  return `${n.toFixed(1)}%`;
}

function playerKey(r) {
  return String(r.playerId || r.id || r.player || r.name || "").trim();
}

function labelPlayer(r) {
  return r.player || r.name || "This hitter";
}

function buildBreakdown(r) {
  const player = labelPlayer(r);
  const key = String(player).toLowerCase().trim();
  const context = contextByName.get(key) || contextById.get(String(r.playerId || r.id || "")) || {};

  const team = r.team || context.team || context.playerTeam || context.batterTeam || "";
  const opponent = r.opponent || r.vs || context.opponent || context.opp || "";
  const game = r.game || context.game || context.matchup || (team && opponent ? `${team} vs ${opponent}` : "");
  const pitcher = r.pitcher || r.opposingPitcher || r.probablePitcher || context.pitcher || context.opposingPitcher || context.probablePitcher || "the opposing starter";

  const hr = num(r.hrConfidence ?? r.realHrProbability ?? r.hrProbability);
  const power = num(r.powerScore);
  const pitcherRisk = num(r.pitcherRisk);
  const weather = num(r.weatherBoost ?? r.weatherCarry ?? r.pullWindBoost);
  const bullpen = num(r.bullpenBoost ?? r.bullpen);
  const pitchType = num(r.pitchTypeEdge ?? r.pitchTypeDestructionScore);
  const launch = num(r.launchProfileScore ?? r.launchScore);
  const volatility = num(r.volatilityScore);
  const park = num(r.parkFactor ?? r.parkBoost);

  const dailySectionBoost =
    num(r.aiDailyBoost) ||
    num(r.consensusScore) ||
    num(r.valueScore) * 0.20 ||
    0;

  const lineupBoost =
    /confirmed/i.test(String(r.lineupStatus || r.teamLineupStatus || "")) ? 4 :
    /projected/i.test(String(r.lineupStatus || r.teamLineupStatus || "")) ? 1.5 :
    0;

  const dailyContextScore =
    pitcherRisk * 0.34 +
    Math.max(weather, 0) * 0.28 +
    pitchType * 0.22 +
    launch * 0.16 +
    Math.max(bullpen, 0) * 0.14 +
    Math.max(park, 0) * 0.12 +
    hr * 0.85 +
    power * 0.08 +
    dailySectionBoost +
    lineupBoost;

  const score = dailyContextScore;

  const g = "PENDING";

  const reasons = [];

  if (hr) reasons.push(`${pct(hr)} model HR confidence`);
  if (power >= 70) reasons.push("Elite power profile");
  else if (power >= 55) reasons.push("Above-average power profile");

  if (pitcherRisk >= 100) reasons.push("Extremely vulnerable opposing pitcher");
  else if (pitcherRisk >= 85) reasons.push("One of the weakest pitcher matchups on the slate");
  else if (pitcherRisk >= 70) reasons.push("Clear pitcher vulnerability edge");
  else if (pitcherRisk >= 60) reasons.push("Positive pitcher matchup");

  if (weather >= 10) reasons.push("Weather and carry conditions add HR upside");
  else if (weather >= 5) reasons.push("Small weather carry lift");

  if (bullpen >= 10) reasons.push("Late-game bullpen environment adds HR upside");
  if (pitchType >= 65) reasons.push("Strong pitch-type fit against the expected arsenal");
  if (launch >= 65) reasons.push("Launch-angle profile fits the matchup");
  if (park >= 8) reasons.push("Ballpark environment supports power");

  const reasonText = reasons.length
    ? reasons.join(", ")
    : "a balanced profile across the model inputs";

  let sentence2 = `${player} checks in with ${reasonText}.`;

  let sentence3 = "";
  if (pitcherRisk >= 70 && power >= 65) {
    sentence3 = `The power profile and opposing pitcher vulnerability line up well, creating one of the cleaner HR paths on the board.`;
  } else if (weather >= 8) {
    sentence3 = `The run environment adds extra carry, helping push this matchup above a normal power spot.`;
  } else if (pitchType >= 65) {
    sentence3 = `The expected pitch mix is one of the main reasons the model is giving him extra attention today.`;
  } else {
    sentence3 = `The edge is not built on one metric alone, but the full profile is strong enough to keep him firmly in the mix.`;
  }

  return {
    playerId: r.playerId || r.id || idByName.get(String(player).toLowerCase().trim()) || null,
    player,
    team,
    opponent,
    game,
    pitcher,
    grade: g,
    score: Number(score.toFixed(1)),
    title: "Slip Lab AI Breakdown",
    summary: `The model gives ${player} ${["A+", "A"].includes(g) ? "an" : "a"} ${g} HR grade against ${pitcher}. ${sentence2} ${sentence3}`,
    reasons
  };
}

const dc = readJson(DC_FILE, {});
const poolRaw = readJson(POOL_FILE, []);
const poolRows = Array.isArray(poolRaw) ? poolRaw : (poolRaw.players || poolRaw.allPlayers || []);
const idByName = new Map(poolRows.filter(x => x.player || x.name).map(x => [String(x.player || x.name).toLowerCase().trim(), x.playerId || x.id]));

const contextByName = new Map(
  poolRows
    .filter(x => x.player || x.name)
    .map(x => [String(x.player || x.name).toLowerCase().trim(), x])
);

const contextById = new Map(
  poolRows
    .filter(x => x.playerId || x.id)
    .map(x => [String(x.playerId || x.id), x])
);

const rows = [];

if (Array.isArray(dc.allPlayers)) rows.push(...dc.allPlayers);

if (dc.sections && typeof dc.sections === "object") {
  for (const arr of Object.values(dc.sections)) {
    if (Array.isArray(arr)) rows.push(...arr);
  }
}

/*
  Safety net:
  AI Says must include every current MLB player from the player pool,
  even if that player did not land inside a Decision Center section.
*/
const existingPlayers = new Set(rows.map(r => String(r.player || r.name || "").toLowerCase().trim()));

for (const p of poolRows) {
  const name = String(p.player || p.name || "").toLowerCase().trim();
  if (!name || existingPlayers.has(name)) continue;
  rows.push(p);
}

const map = new Map();

for (const r of rows) {
  const key = playerKey(r);
  if (!key) continue;

  const existing = map.get(key);
  const next = buildBreakdown(r);

  if (!existing || next.score > existing.score) {
    map.set(key, next);
  }
}

function sectionHit(player, sectionName) {
  const arr = dc?.sections?.[sectionName] || [];
  const name = String(player || "").toLowerCase().trim();
  return arr.some(r => String(r.player || r.name || "").toLowerCase().trim() === name);
}


  function buildExplanationScores(info) {
    const reasons = (info.reasons || []).join(" ").toLowerCase();

    let power = 65;
    let matchup = 65;
    let environment = 65;

    if (reasons.includes("elite power profile")) {
      power = 95;
    } else if (reasons.includes("above-average power")) {
      power = 82;
    } else if (reasons.includes("power profile")) {
      power = 75;
    }

    if (reasons.includes("extremely vulnerable opposing pitcher")) {
      matchup = 96;
    } else if (reasons.includes("one of the weakest pitcher matchups")) {
      matchup = 92;
    } else if (reasons.includes("clear pitcher vulnerability")) {
      matchup = 86;
    } else if (reasons.includes("positive pitcher matchup")) {
      matchup = 80;
    }

    if (reasons.includes("weather")) {
      environment = 92;
    } else if (reasons.includes("bullpen")) {
      environment = 88;
    } else if (reasons.includes("launch")) {
      environment = 84;
    }

    return {
      power,
      matchup,
      environment,
      certainty: Math.round(info.score || 80)
    };
  }


const sorted = [...map.entries()].sort((a, b) => b[1].score - a[1].score);

sorted.forEach(([, info], index) => {
  const rank = index + 1;
  info.rank = rank;
  info.grade = grade(info.score, rank);
  info.badges = [];

  if (rank === 1) info.badges.push("🧠 AI #1");
  else if (rank <= 5) info.badges.push(`🧠 AI #${rank}`);

  const reasonText = (info.reasons || []).join(" ").toLowerCase();
  if (reasonText.includes("power")) info.badges.push("🔥 Power Fit");
  if (reasonText.includes("pitcher")) info.badges.push("🎯 Pitcher Leak");
  if (reasonText.includes("weather") || reasonText.includes("carry")) info.badges.push("🌪 Weather Carry");
  if (reasonText.includes("bullpen")) info.badges.push("💣 HR Upside");
  if (reasonText.includes("pitch-type") || reasonText.includes("arsenal")) info.badges.push("🧬 Pitch Mix Edge");

  

  info.consensus = [];
  if (sectionHit(info.player, "bestPicks")) info.consensus.push("🔥 AI + Best Pick");
  if (sectionHit(info.player, "bestValue")) info.consensus.push("💰 AI + Best Value");
  if (sectionHit(info.player, "dueForHr")) info.consensus.push("⏳ AI + Due List");
  if (sectionHit(info.player, "weatherCarry")) info.consensus.push("🌪 AI + Weather");
  if (sectionHit(info.player, "pitchTypeEdges")) info.consensus.push("🧬 AI + Pitch Edge");
  if (sectionHit(info.player, "bullpenBoosts")) info.consensus.push("💣 AI + Bullpen");

  let consensusScore = 0;

  if (sectionHit(info.player, "bestPicks")) consensusScore += 20;
  if (sectionHit(info.player, "bestValue")) consensusScore += 15;
  if (sectionHit(info.player, "dueForHr")) consensusScore += 15;
  if (sectionHit(info.player, "weatherCarry")) consensusScore += 15;
  if (sectionHit(info.player, "pitchTypeEdges")) consensusScore += 15;
  if (sectionHit(info.player, "bullpenBoosts")) consensusScore += 20;

  info.consensusScore = Math.min(100, consensusScore);
  info.agreementCount = info.consensus.length;

  if (info.consensus.length >= 3) info.badges.unshift("⚡ Triple Consensus");
  else if (info.consensus.length >= 2) info.badges.unshift("✅ Multi-Model Agree");

  info.explanationScores = buildExplanationScores(info);

  info.matchupReason = (info.reasons || []).find(r => /pitch-type|arsenal|power|confidence/i.test(r)) || "";
  info.pitcherReason = (info.reasons || []).find(r => /pitcher|bullpen/i.test(r)) || "";
  info.environmentReason = (info.reasons || []).find(r => /weather|carry|ballpark|launch/i.test(r)) || "";
});

const out = {
  updatedAt: new Date().toISOString(),
  source: "hr_decision_center.json",
  count: map.size,
  players: Object.fromEntries(sorted)
};

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

console.log("HR AI BREAKDOWNS COMPLETE");
console.log("Players:", map.size);
console.log("Saved:", OUT_FILE);
