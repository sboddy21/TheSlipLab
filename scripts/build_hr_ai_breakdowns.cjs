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

function clean(v) {
  return String(v ?? "").trim();
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function dailyHash(name) {
  const seed = `${todayKey()}:${name}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return Math.abs(h % 1000) / 1000;
}

function keyName(r) {
  return clean(r.player || r.name || r.batter || r.hitter).toLowerCase();
}

function playerId(r) {
  return r.playerId || r.id || null;
}

function grade(score, rank) {
  if (rank === 1 && score >= 82) return "A+";
  if (rank <= 6 && score >= 74) return "A";
  if (score >= 62) return "B+";
  if (score >= 48) return "B";
  return "C+";
}

function pct(v) {
  const n = num(v);
  return n ? `${n.toFixed(1)}%` : null;
}

const dc = readJson(DC_FILE, {});
const poolRaw = readJson(POOL_FILE, []);
const poolRows = Array.isArray(poolRaw) ? poolRaw : (poolRaw.players || poolRaw.allPlayers || []);

const contextByName = new Map(poolRows.map(p => [keyName(p), p]));
const contextById = new Map(poolRows.filter(p => playerId(p)).map(p => [String(playerId(p)), p]));

const rows = [];
const sectionMap = new Map();

function pushSection(section, weight, role, arr) {
  if (!Array.isArray(arr)) return;
  arr.forEach((r, i) => {
    const name = keyName(r);
    const prev = sectionMap.get(name) || { sections: [], boost: 0, bestRank: 999 };
    prev.sections.push(section);
    prev.boost += Math.max(0, weight - i * 1.25);
    prev.bestRank = Math.min(prev.bestRank, i + 1);
    sectionMap.set(name, prev);
    rows.push({ ...r, aiSection: section, aiRole: role, aiSectionWeight: weight });
  });
}

const sections = dc.sections || {};

pushSection("ifOnlyOne", 42, "AI Favorite Candidate", sections.ifOnlyOne);
pushSection("pitchTypeEdges", 38, "Pitch Mix Exploit", sections.pitchTypeEdges);
pushSection("weatherCarry", 34, "Environment Boost", sections.weatherCarry);
pushSection("bullpenBoosts", 30, "Late Game Edge", sections.bullpenBoosts);
pushSection("bestValue", 28, "Hidden Value", sections.bestValue);
pushSection("lottoBombs", 24, "Volatile Ceiling", sections.lottoBombs);
pushSection("bestPicks", 18, "Main Board Overlap", sections.bestPicks);
pushSection("safestPlays", 12, "Safety Profile", sections.safestPlays);

if (Array.isArray(dc.allPlayers)) {
  dc.allPlayers.forEach(r => rows.push({ ...r, aiSection: "allPlayers", aiRole: "Slate Context", aiSectionWeight: 4 }));
}

const existing = new Set(rows.map(keyName));
for (const p of poolRows) {
  if (!keyName(p) || existing.has(keyName(p))) continue;
  rows.push({ ...p, aiSection: "poolOnly", aiRole: "Player Pool Depth", aiSectionWeight: -30 });
}

function buildPlayer(r) {
  const name = clean(r.player || r.name || r.batter || r.hitter);
  const context = contextByName.get(name.toLowerCase()) || contextById.get(String(playerId(r))) || {};
  const team = clean(r.team || context.team || context.playerTeam || context.batterTeam);
  const opponent = clean(r.opponent || r.vs || context.opponent || context.opp);
  const game = clean(r.game || context.game || context.matchup || (team && opponent ? `${team} vs ${opponent}` : ""));
  const pitcher = clean(r.pitcher || r.opposingPitcher || r.probablePitcher || context.pitcher || context.opposingPitcher || context.probablePitcher || "opposing starter");

  const hr = num(r.hrConfidence ?? r.realHrProbability ?? r.hrProbability);
  const power = num(r.powerScore);
  const pitcherRisk = num(r.pitcherRisk);
  const weather = num(r.weatherBoost ?? r.weatherCarry ?? r.pullWindBoost);
  const bullpen = num(r.bullpenBoost ?? r.bullpen);
  const pitchType = num(r.pitchTypeEdge ?? r.pitchTypeDestructionScore);
  const launch = num(r.launchProfileScore ?? r.launchScore);
  const park = num(r.parkFactor ?? r.parkBoost);
  const volatility = num(r.volatilityScore);

  const meta = sectionMap.get(name.toLowerCase()) || { sections: [], boost: 0, bestRank: 999 };
  const dailyNoise = dailyHash(name) * 10;

  const intelligenceScore =
    pitcherRisk * 0.48 +
    pitchType * 0.42 +
    Math.max(weather, 0) * 0.40 +
    launch * 0.30 +
    Math.max(bullpen, 0) * 0.26 +
    Math.max(park, 0) * 0.22 +
    Math.min(meta.boost, 28) +
    dailyNoise +
    hr * 0.22 +
    power * 0.05 -
    (meta.sections.includes("bestPicks") ? 8 : 0) -
    (power >= 75 && hr >= 15 ? 6 : 0);

  const reasons = [];
  if (pitcherRisk >= 85) reasons.push("Pitcher vulnerability is one of the strongest daily signals.");
  else if (pitcherRisk >= 70) reasons.push("Positive pitcher vulnerability on today’s slate.");

  if (pitchType >= 65) reasons.push("Pitch mix lines up with the hitter damage profile.");
  if (weather >= 6) reasons.push("Weather/park carry adds a real environment boost.");
  if (bullpen >= 8) reasons.push("Bullpen path adds late-game HR upside.");
  if (launch >= 60) reasons.push("Launch profile fits the type of contact needed today.");
  if (meta.sections.includes("bestValue")) reasons.push("The model sees a hidden value angle beyond the main board.");
  if (meta.sections.includes("lottoBombs")) reasons.push("Volatile profile, but the ceiling is live.");
  if (meta.sections.includes("ifOnlyOne")) reasons.push("Strong enough to enter the AI final-decision conversation.");

  if (!reasons.length) reasons.push("The full daily context is stronger than the raw season profile suggests.");

  let title = "AI Slate Read";
  if (meta.sections.includes("ifOnlyOne")) title = "AI Finalist";
  else if (meta.sections.includes("pitchTypeEdges")) title = "AI Pitch Mix Exploit";
  else if (meta.sections.includes("weatherCarry")) title = "AI Environment Play";
  else if (meta.sections.includes("bestValue")) title = "AI Sneaky Play";
  else if (meta.sections.includes("lottoBombs")) title = "AI Ceiling Shot";

  const badges = [];
  if (meta.sections.length >= 3) badges.push("⚡ Multi-Signal");
  if (pitcherRisk >= 75) badges.push("🎯 Pitcher Leak");
  if (pitchType >= 65) badges.push("🧬 Pitch Mix Edge");
  if (weather >= 6) badges.push("🌬️ Carry Boost");
  if (bullpen >= 8) badges.push("🔥 Bullpen Edge");
  if (meta.sections.includes("bestValue")) badges.push("💎 Hidden Angle");
  if (meta.sections.includes("lottoBombs")) badges.push("💣 Ceiling Shot");

  return {
    playerId: playerId(r),
    player: name,
    team,
    opponent,
    game,
    pitcher,
    title,
    aiRole: r.aiRole || title,
    aiSections: meta.sections,
    score: Number(intelligenceScore.toFixed(1)),
    grade: "PENDING",
    confidence: pct(Math.max(0, Math.min(99, intelligenceScore))),
    summary: `${name} is not being graded as a season-long power profile here. AI Says likes this spot because ${reasons.join(" ")}`,
    reasons,
    badges,
    explanationScores: {
      power: Math.round(Math.min(100, power || 55)),
      matchup: Math.round(Math.min(100, pitcherRisk || 55)),
      environment: Math.round(Math.min(100, Math.max(weather, park, bullpen, launch, 55))),
      certainty: Math.round(Math.min(100, Math.max(40, intelligenceScore)))
    },
    pitcherReason: pitcherRisk >= 70 ? `${pitcher} creates a daily matchup edge.` : `${pitcher} is not the whole reason for the grade.`,
    matchupReason: pitchType >= 60 ? "Pitch-type fit is driving the AI read." : "The edge comes from combined daily context.",
    environmentReason: weather >= 6 || park >= 6 || bullpen >= 8 ? "Environment adds support to the HR path." : "Environment is not the primary driver."
  };
}

const map = new Map();

for (const r of rows) {
  const name = keyName(r);
  if (!name) continue;
  const built = buildPlayer(r);
  const old = map.get(name);
  if (!old || built.score > old.score) map.set(name, built);
}

const sorted = [...map.values()].sort((a, b) => b.score - a.score);

sorted.forEach((p, i) => {
  p.rank = i + 1;
  p.grade = grade(p.score, p.rank);
  if (p.rank === 1) p.badges.unshift("🧠 AI #1");
  else if (p.rank <= 5) p.badges.unshift(`🧠 AI #${p.rank}`);
});

const output = {
  date: todayKey(),
  updatedAt: new Date().toISOString(),
  source: "AI intelligence layer using daily Decision Center, pitcher, pitch mix, environment, bullpen, and slate movement signals.",
  philosophy: "AI Says is not a copy of the HR board. It identifies the smartest daily angles, traps, overlooked players, and matchup paths.",
  playerCount: sorted.length,
  featured: {
    favorite: sorted[0] || null,
    runnerUp: sorted[1] || null,
    sneakyPlay: sorted.find(p => p.aiSections.includes("bestValue")) || sorted[2] || null,
    pitchExploit: sorted.find(p => p.aiSections.includes("pitchTypeEdges")) || sorted[3] || null,
    environmentPlay: sorted.find(p => p.aiSections.includes("weatherCarry") || p.badges.includes("🌬️ Carry Boost")) || sorted[4] || null,
    ceilingShot: sorted.find(p => p.aiSections.includes("lottoBombs")) || sorted[5] || null
  },
  players: Object.fromEntries(sorted.map(p => [p.player, p]))
};

fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

console.log("HR AI INTELLIGENCE ENGINE COMPLETE");
console.log("Players:", sorted.length);
console.log("Saved:", OUT_FILE);
