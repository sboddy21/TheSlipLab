const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const AI_FILE = path.join(ROOT, "website/data/hr_ai_breakdowns.json");
const MOVE_FILE = path.join(ROOT, "website/data/hr_ai_movement.json");
const OUT_FILE = path.join(ROOT, "website/data/ai_trust_engine.json");

function read(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v, min = 0, max = 100){
  return Math.max(min, Math.min(max, v));
}

function gradeBoost(g){
  if (g === "A+") return 8;
  if (g === "A") return 5;
  if (g === "B+") return 2;
  if (g === "B") return 0;
  return -4;
}

function riskFrom(score){
  if (score >= 90) return "Low";
  if (score >= 80) return "Medium Low";
  if (score >= 70) return "Medium";
  if (score >= 60) return "Volatile";
  return "High";
}

function labelFrom(score){
  if (score >= 90) return "Elite Trust";
  if (score >= 80) return "Strong Trust";
  if (score >= 70) return "Moderate Trust";
  if (score >= 60) return "Volatile Trust";
  return "High Risk";
}

function trendScore(player, movement){
  const name = String(player.player || "").trim();
  const found =
    [...(movement.risers || []), ...(movement.fallers || []), ...(movement.stable || [])]
      .find(r => String(r.player || "").trim() === name);

  if (!found) return 72;

  const rankChange = num(found.rankChange);
  const scoreChange = num(found.scoreChange);

  return clamp(75 + rankChange * 3 + scoreChange * 1.5);
}

function pitchMixScore(row){
  const reasons = `${(row.reasons || []).join(" ")} ${(row.badges || []).join(" ")} ${(row.consensus || []).join(" ")}`;

  let score = num(row.explanationScores?.matchup) || num(row.score) || 70;

  if (/pitch mix|pitch edge|arsenal|pitch/i.test(reasons)) score += 8;
  if (/vulnerable|leak|damage/i.test(reasons)) score += 5;
  if (/extremely vulnerable/i.test(reasons)) score += 5;

  return clamp(score);
}

function buildStrengths(row){
  const out = [];
  const text = `${(row.reasons || []).join(" ")} ${(row.consensus || []).join(" ")} ${(row.badges || []).join(" ")}`;

  if (/power|barrel|hard|elite/i.test(text)) out.push("Elite power profile");
  if (/pitch mix|pitch edge|arsenal/i.test(text)) out.push("Pitch mix edge");
  if (/vulnerable|leak/i.test(text)) out.push("Pitcher vulnerability");
  if (/weather|wind|carry/i.test(text)) out.push("Weather or park boost");
  if (/bullpen/i.test(text)) out.push("Bullpen path");
  if (/value/i.test(text)) out.push("Market value");
  if (/consensus|agreement|triple/i.test(text)) out.push("Strong model agreement");

  return [...new Set(out)].slice(0,5);
}

function buildWeaknesses(row, trustScore){
  const out = [];

  if (trustScore < 70) out.push("Lower overall AI trust score");
  if (num(row.confidence) < 8) out.push("Lower model HR confidence");
  if (num(row.consensusScore) < 35) out.push("Limited consensus support");
  if (!row.pitcher) out.push("Pitcher context incomplete");

  return out.slice(0,4);
}

function buildSummary(row, trustScore, risk, breakdown){
  const strengths = buildStrengths(row);
  const lead = strengths.length ? strengths.slice(0,3).join(", ") : "overall model profile";

  return `${row.player} carries a ${trustScore}/100 AI Trust Score with ${risk.toLowerCase()} risk. The profile is driven by ${lead}, with Power ${breakdown.power}, Matchup ${breakdown.matchup}, Pitch Mix ${breakdown.pitchMix}, Environment ${breakdown.environment}, Consensus ${breakdown.consensus}, and Trend ${breakdown.trend}.`;
}

const ai = read(AI_FILE, { players: {} });
const movement = read(MOVE_FILE, { risers: [], fallers: [], stable: [] });

const players = Object.values(ai.players || {}).map(row => {
  const power = clamp(num(row.explanationScores?.power) || num(row.score) + 4);
  const matchup = clamp(num(row.explanationScores?.matchup) || num(row.score));
  const environment = clamp(num(row.explanationScores?.environment) || 70);
  const pitchMix = pitchMixScore(row);
  const consensus = clamp(num(row.consensusScore) || (num(row.agreementCount) * 18));
  const trend = trendScore(row, movement);

  const base =
    power * 0.22 +
    matchup * 0.22 +
    pitchMix * 0.18 +
    environment * 0.12 +
    consensus * 0.16 +
    trend * 0.10;

  const trustScore = Math.round(clamp(base + gradeBoost(row.grade)));
  const risk = riskFrom(trustScore);

  const breakdown = {
    power: Math.round(power),
    matchup: Math.round(matchup),
    pitchMix: Math.round(pitchMix),
    environment: Math.round(environment),
    consensus: Math.round(consensus),
    trend: Math.round(trend)
  };

  return {
    player: row.player,
    playerId: row.playerId || "",
    headshot: row.headshot || "",
    team: row.team || "",
    opponent: row.opponent || "",
    pitcher: row.pitcher || "",
    rank: num(row.rank),
    grade: row.grade || "B",
    score: num(row.score),
    confidence: num(row.confidence),
    trustScore,
    trustLabel: labelFrom(trustScore),
    risk,
    breakdown,
    strengths: buildStrengths(row),
    weaknesses: buildWeaknesses(row, trustScore),
    summary: buildSummary(row, trustScore, risk, breakdown),
    source: {
      aiScore: num(row.score),
      modelConfidence: num(row.confidence),
      consensusScore: num(row.consensusScore),
      agreementCount: num(row.agreementCount)
    }
  };
});

players.sort((a,b) =>
  b.trustScore - a.trustScore ||
  b.score - a.score ||
  a.rank - b.rank
);

const byPlayer = {};
players.forEach(p => {
  byPlayer[p.player] = p;
});

const out = {
  updatedAt: new Date().toISOString(),
  version: "AI Trust Engine 3.0",
  source: "hr_ai_breakdowns.json + hr_ai_movement.json",
  playerCount: players.length,
  tierCounts: {
    elite: players.filter(p => p.trustScore >= 90).length,
    strong: players.filter(p => p.trustScore >= 80 && p.trustScore < 90).length,
    moderate: players.filter(p => p.trustScore >= 70 && p.trustScore < 80).length,
    volatile: players.filter(p => p.trustScore >= 60 && p.trustScore < 70).length,
    highRisk: players.filter(p => p.trustScore < 60).length
  },
  players,
  byPlayer
};

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

console.log("AI TRUST ENGINE COMPLETE");
console.log("Players:", out.playerCount);
console.log("Elite:", out.tierCounts.elite);
console.log("Strong:", out.tierCounts.strong);
console.log("Saved:", OUT_FILE);
