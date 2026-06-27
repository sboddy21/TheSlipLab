const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website/data");
const OUT = path.join(DATA, "ai_reasoning_engine.json");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  } catch {
    return fallback;
  }
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function text(v, d = "") {
  return String(v ?? d).trim();
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function getName(row) {
  return (
    row.player ||
    row.name ||
    row.playerName ||
    row.batterName ||
    row.hitter ||
    ""
  );
}

function pct(v) {
  return Math.round(clamp(num(v)));
}

const decision = readJson("hr_decision_center.json", {});
const breakdowns = readJson("hr_ai_breakdowns.json", {});
const movement = readJson("hr_ai_movement.json", {});
const history = readJson("hr_ai_history.json", {});
const hof = readJson("hr_ai_hof.json", {});
const stacks = readJson("hr_ai_stacks.json", {});
const weather = readJson("weather_board.json", {});
const powerZones = readJson("power_zones.json", {});
const pitcherMatchups = readJson("game_pitcher_matchups.json", {});
const bullpen = readJson("bullpen_relievers.json", {});

const allPlayers =
  decision.allPlayers ||
  decision.players ||
  Object.values(decision.sections || {}).flat() ||
  [];

const sectionByPlayer = {};
for (const [section, rows] of Object.entries(decision.sections || {})) {
  if (!Array.isArray(rows)) continue;
  for (const row of rows) {
    const name = getName(row);
    if (!name) continue;
    sectionByPlayer[name] ||= [];
    sectionByPlayer[name].push(section);
  }
}

function findByName(source, name) {
  if (!source) return null;

  if (Array.isArray(source)) {
    return source.find(r => getName(r) === name) || null;
  }

  if (Array.isArray(source.players)) {
    return source.players.find(r => getName(r) === name) || null;
  }

  if (Array.isArray(source.rows)) {
    return source.rows.find(r => getName(r) === name) || null;
  }

  if (source[name]) return source[name];

  return null;
}

function buildWhy(row, ctx) {
  const reasons = [];

  const hr = num(row.hrProbability ?? row.probability ?? row.hrChance);
  const score = num(row.aiScore ?? row.score ?? row.modelScore);
  const consensus = num(row.consensusScore);
  const value = num(row.valueScore);
  const power = num(row.powerScore ?? row.powerProfile);
  const weatherBoost = num(row.weatherBoost ?? row.carryScore);
  const bullpenBoost = num(row.bullpenBoost);
  const pitch = num(row.pitchMatchScore ?? row.pitchTypeScore);

  if (hr >= 25) reasons.push("Elite home run probability compared to the rest of today's slate.");
  else if (hr >= 18) reasons.push("Strong home run probability profile for today's matchup.");

  if (score >= 85) reasons.push("The overall model score grades as one of the strongest profiles on the board.");
  if (consensus >= 80) reasons.push("Multiple independent engines are aligned on this player.");
  if (value >= 75) reasons.push("The betting value profile is stronger than the raw market price suggests.");
  if (power >= 80) reasons.push("Power profile supports legitimate home run upside.");
  if (weatherBoost >= 8) reasons.push("Weather and carry conditions are helping the ball today.");
  if (bullpenBoost >= 8) reasons.push("Late game bullpen context adds extra home run upside.");
  if (pitch >= 80) reasons.push("Pitch mix matchup fits the hitter's power strengths.");

  if (ctx.sections.includes("ifOnlyOne")) reasons.push("This player appears in the I Can Only Pick One pool.");
  if (ctx.sections.includes("bestPicks")) reasons.push("This player appears in the top overall Decision Center group.");
  if (ctx.sections.includes("safestPlays")) reasons.push("This player has one of the safer power profiles on today's slate.");
  if (ctx.sections.includes("bestValue")) reasons.push("This player is flagged as a value target.");
  if (ctx.sections.includes("lottoBombs")) reasons.push("This player has longshot home run upside.");

  if (!reasons.length) {
    reasons.push("The model found enough supporting signals to keep this player in the home run pool.");
  }

  return [...new Set(reasons)].slice(0, 7);
}

function buildRisks(row) {
  const risks = [];

  const kRisk = num(row.kRisk ?? row.strikeoutRisk);
  const weatherBoost = num(row.weatherBoost ?? row.carryScore);
  const probability = num(row.hrProbability ?? row.probability ?? row.hrChance);
  const confidence = num(row.confidence ?? row.aiConfidence);
  const value = num(row.valueScore);

  if (kRisk >= 70) risks.push("Strikeout risk could limit the number of quality contact chances.");
  if (weatherBoost < 0) risks.push("Weather is not helping carry today.");
  if (probability < 15) risks.push("Raw home run probability is still volatile.");
  if (confidence && confidence < 65) risks.push("Model agreement is not as strong as the top tier plays.");
  if (value && value < 45) risks.push("Market price may not offer much value.");

  if (!risks.length) {
    risks.push("Home run betting is naturally volatile, even with a strong profile.");
  }

  return risks.slice(0, 4);
}

function verdictLabel(confidence, probability) {
  if (confidence >= 90 && probability >= 24) return "Elite AI Play";
  if (confidence >= 82 && probability >= 18) return "Strong AI Play";
  if (confidence >= 72 && probability >= 14) return "Playable HR Target";
  if (confidence >= 62) return "Lean / Watch List";
  return "Volatile Longshot";
}

function buildOne(row) {
  const name = getName(row);
  const sections = sectionByPlayer[name] || [];

  const b = findByName(breakdowns.players || breakdowns, name);
  const m = findByName(movement.players || movement, name);
  const h = findByName(history.players || history, name);
  const z = findByName(powerZones.players || powerZones, name);
  const hofRow = findByName(hof.players || hof, name);

  const probability = pct(
    row.hrProbability ??
    row.probability ??
    row.hrChance ??
    row.aiProbability ??
    row.modelProbability ??
    0
  );

  const pitchMatch = pct(row.pitchMatchScore ?? row.pitchTypeScore ?? b?.pitchMatchScore ?? 70);
  const weatherScore = pct(row.weatherScore ?? row.weatherBoost ?? b?.weatherScore ?? 70);
  const bullpenEdge = pct(row.bullpenScore ?? row.bullpenBoost ?? b?.bullpenScore ?? 70);
  const marketEdge = pct(row.valueScore ?? row.marketScore ?? row.consensusScore ?? 70);
  const historyMatch = pct(h?.historyScore ?? h?.similarityScore ?? row.historyScore ?? 70);
  const powerProfile = pct(row.powerScore ?? row.powerProfile ?? z?.powerScore ?? 70);
  const recentForm = pct(row.recentScore ?? row.formScore ?? b?.recentScore ?? 70);
  const modelAgreement = pct(row.consensusScore ?? row.aiTrust ?? row.aiScore ?? row.score ?? 70);

  const confidence = pct(
    (
      pitchMatch * 0.18 +
      weatherScore * 0.13 +
      bullpenEdge * 0.12 +
      marketEdge * 0.12 +
      historyMatch * 0.15 +
      powerProfile * 0.15 +
      recentForm * 0.08 +
      modelAgreement * 0.07
    )
  );

  const ctx = { sections };

  const whyToday = buildWhy(row, ctx);
  const riskFactors = buildRisks(row);

  const aiVerdict = verdictLabel(confidence, probability);

  const oneLine =
    whyToday[0] ||
    text(row.summary) ||
    "Strong model profile for today's home run slate.";

  return {
    player: name,
    team: text(row.team ?? row.teamAbbr ?? row.teamName),
    opponent: text(row.opponent ?? row.opp),
    game: text(row.game ?? row.matchup),
    sections,
    aiVerdict,
    oneLine,
    probability,
    confidence,
    stars: confidence >= 90 ? 5 : confidence >= 80 ? 4 : confidence >= 70 ? 3 : confidence >= 60 ? 2 : 1,
    whyToday,
    riskFactors,
    trustBreakdown: {
      modelAgreement,
      pitchMatch,
      powerProfile,
      weather: weatherScore,
      bullpen: bullpenEdge,
      market: marketEdge,
      history: historyMatch,
      recentForm
    },
    homeRunDNA: {
      pullPower: pct(row.pullPower ?? z?.pullPower ?? powerProfile),
      fastballHunter: pct(row.fastballScore ?? row.fastballHunter ?? pitchMatch),
      mistakePunisher: pct(row.damageScore ?? row.barrelScore ?? powerProfile),
      flyBallSwing: pct(row.flyBallScore ?? row.launchScore ?? recentForm),
      weatherBoost: weatherScore,
      bullpenHunter: bullpenEdge,
      recentForm
    },
    expected: {
      pitch: text(row.expectedPitch ?? b?.expectedPitch ?? row.bestPitch ?? "Best matchup pitch"),
      zone: text(row.expectedZone ?? b?.expectedZone ?? "Damage zone"),
      distance: Math.round(num(row.expectedDistance ?? b?.expectedDistance ?? row.projectedDistance ?? 410)),
      count: text(row.expectedCount ?? "Hitter's count")
    },
    movement: {
      previousScore: num(m?.previousScore ?? m?.yesterdayScore ?? 0),
      currentScore: num(m?.currentScore ?? row.aiScore ?? row.score ?? 0),
      change: num(m?.change ?? m?.movement ?? 0),
      note: text(m?.note ?? "")
    },
    history: {
      similarity: historyMatch,
      hrHits: num(h?.hrHits ?? h?.wins ?? 0),
      misses: num(h?.misses ?? 0),
      note: text(h?.note ?? "")
    },
    hof: hofRow || null,
    source: {
      decisionCenter: true,
      breakdown: !!b,
      movement: !!m,
      history: !!h,
      powerZones: !!z
    }
  };
}

const reports = allPlayers
  .map(buildOne)
  .filter(r => r.player)
  .sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.probability - a.probability;
  });

const out = {
  sport: "MLB",
  market: "Home Runs",
  version: "1.0",
  updatedAt: new Date().toISOString(),
  playerCount: reports.length,
  notes: [
    "AI Reasoning Engine 1.0 creates one unified player report for every home run candidate.",
    "This file is designed to power AI Says, Decision Center cards, player modals, and Results explanations.",
    "Existing pages remain unchanged until this file is connected to the frontend."
  ],
  topReports: reports.slice(0, 25),
  reports
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log("AI REASONING ENGINE COMPLETE");
console.log("Players:", reports.length);
console.log("Saved:", OUT);
