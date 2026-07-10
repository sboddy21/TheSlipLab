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

function pct(v) {
  const n = num(v);
  return Math.round(clamp(n <= 1 && n > 0 ? n * 100 : n));
}

function getName(row) {
  return text(
    row?.player ||
    row?.name ||
    row?.playerName ||
    row?.batterName ||
    row?.hitter ||
    row?.fullName ||
    row?.displayName ||
    row?.player_name
  );
}

function extractPlayers(data) {
  if (!data) return [];

  if (Array.isArray(data)) return data.filter(x => x && typeof x === "object");

  const rows = [];

  for (const key of ["players", "rows", "data", "reports", "items", "picks", "projections"]) {
    if (Array.isArray(data[key])) rows.push(...data[key]);
  }

  if (data.byPlayer && typeof data.byPlayer === "object") {
    rows.push(...Object.values(data.byPlayer));
  }

  if (data.sections && typeof data.sections === "object") {
    for (const [section, value] of Object.entries(data.sections)) {
      if (Array.isArray(value)) {
        rows.push(...value.map(r => ({ ...r, aiDailySection: r.aiDailySection || section })));
      } else if (Array.isArray(value?.players)) {
        rows.push(...value.players.map(r => ({ ...r, aiDailySection: r.aiDailySection || section })));
      } else if (Array.isArray(value?.rows)) {
        rows.push(...value.rows.map(r => ({ ...r, aiDailySection: r.aiDailySection || section })));
      }
    }
  }

  return rows.filter(x => x && typeof x === "object");
}

function mergeRows(files) {
  const map = new Map();
  const debug = {};

  for (const file of files) {
    const data = readJson(file, null);
    const rows = extractPlayers(data);
    debug[file] = rows.length;

    for (const row of rows) {
      const name = getName(row);
      if (!name) continue;

      const current = map.get(name) || {};
      map.set(name, { ...current, ...row, player: name });
    }
  }

  return { rows: [...map.values()], debug };
}

const SOURCE_FILES = [
  "ai_trust_engine.json",
  "hr_power_profiles.json",
  "hr_probability_tracking.json",
  "mlb_hits.json",
  "mlb_total_bases.json",
  "mlb_rbis.json"
];

const { rows: allPlayers, debug } = mergeRows(SOURCE_FILES);

function pickScore(row, keys, fallback = 70) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") {
      if (k === "realHrProbability") {
        const probability = num(row[k]);
        const normalized = probability > 0 && probability <= 1 ? probability * 100 : probability;
        return Math.round(clamp(normalized) * 10) / 10;
      }
      return pct(row[k]);
    }
  }
  return fallback;
}

function buildWhy(row) {
  const reasons = [];

  const trust = pickScore(row, ["aiTrust", "trustScore", "confidence", "aiConfidence"], 70);
  const power = pickScore(row, ["powerScore", "powerProfile", "hrPowerScore", "barrelScore", "damageScore"], 70);
  const recent = pickScore(row, ["recentScore", "formScore", "trendScore", "last7Score"], 70);
  const pitch = pickScore(row, ["pitchMatchScore", "pitchTypeScore", "pitchScore"], 70);
  const value = pickScore(row, ["valueScore", "marketScore", "edgeScore"], 70);
  const probability = pickScore(row, ["realHrProbability", "hrProbability", "probability", "hrChance", "hrProb", "modelProbability"], 0);

  if (probability >= 20) reasons.push("The AI sees a strong home run probability profile for today's slate.");
  if (trust >= 85) reasons.push("The AI Trust Engine shows strong agreement across multiple signals.");
  if (power >= 80) reasons.push("Power indicators support real home run upside.");
  if (recent >= 78) reasons.push("Recent form is strong enough to support an aggressive power read.");
  if (pitch >= 78) reasons.push("The pitch matchup fits this hitter's damage profile.");
  if (value >= 78) reasons.push("The market/value profile is stronger than the raw price suggests.");

  if (row.tags && Array.isArray(row.tags) && row.tags.length) {
    reasons.push(`Player tags support the profile: ${row.tags.slice(0,3).join(", ")}.`);
  }

  if (row.summary || row.cardTake || row.analystTake) {
    reasons.push(text(row.summary || row.cardTake || row.analystTake));
  }

  if (!reasons.length) {
    reasons.push("The AI found enough supporting signals to keep this player in the home run report pool.");
  }

  return [...new Set(reasons)].slice(0, 6);
}

function buildRisks(row) {
  const risks = [];

  const kRisk = pickScore(row, ["kRisk", "strikeoutRisk"], 0);
  const probability = pickScore(row, ["realHrProbability", "hrProbability", "probability", "hrChance", "hrProb"], 0);
  const trust = pickScore(row, ["aiTrust", "trustScore", "confidence", "aiConfidence"], 70);

  if (kRisk >= 70) risks.push("Strikeout risk could limit quality contact chances.");
  if (probability && probability < 15) risks.push("Raw home run probability remains volatile.");
  if (trust < 65) risks.push("Model agreement is weaker than the top tier profiles.");

  risks.push("Home run betting is naturally volatile, even when the process is strong.");

  return [...new Set(risks)].slice(0, 4);
}

function verdict(confidence, probability) {
  if (confidence >= 88 && probability >= 20) return "Elite AI Play";
  if (confidence >= 80 && probability >= 16) return "Strong AI Play";
  if (confidence >= 72) return "Playable HR Target";
  if (confidence >= 62) return "Lean / Watch List";
  return "Volatile Longshot";
}

function buildReport(row) {
  const probability = pickScore(row, ["realHrProbability", "hrProbability", "probability", "hrChance", "hrProb", "modelProbability"], 0);

  const modelAgreement = pickScore(row, ["aiTrust", "trustScore", "consensusScore", "confidence", "aiConfidence"], 70);
  const pitchMatch = pickScore(row, ["pitchMatchScore", "pitchTypeScore", "pitchScore"], 70);
  const powerProfile = pickScore(row, ["powerScore", "powerProfile", "hrPowerScore", "barrelScore", "damageScore"], 70);
  const weather = pickScore(row, ["weatherScore", "weatherBoost", "carryScore"], 70);
  const bullpen = pickScore(row, ["bullpenScore", "bullpenBoost"], 70);
  const market = pickScore(row, ["valueScore", "marketScore", "edgeScore"], 70);
  const history = pickScore(row, ["historyScore", "similarityScore", "trackRecordScore"], 70);
  const recentForm = pickScore(row, ["recentScore", "formScore", "trendScore", "last7Score"], 70);

  const confidence = pct(
    modelAgreement * .20 +
    powerProfile * .18 +
    pitchMatch * .16 +
    recentForm * .12 +
    market * .10 +
    history * .10 +
    weather * .08 +
    bullpen * .06
  );

  const whyToday = buildWhy(row);
  const riskFactors = buildRisks(row);

  return {
    player: getName(row),
    team: text(row.team || row.teamAbbr || row.teamName),
    opponent: text(row.opponent || row.opp),
    game: text(row.game || row.matchup),
    sections: Array.isArray(row.sections) ? row.sections : [row.aiDailySection].filter(Boolean),
    aiVerdict: verdict(confidence, probability),
    oneLine: whyToday[0],
    probability,
    confidence,
    stars: confidence >= 90 ? 5 : confidence >= 80 ? 4 : confidence >= 70 ? 3 : confidence >= 60 ? 2 : 1,
    whyToday,
    riskFactors,
    trustBreakdown: {
      modelAgreement,
      pitchMatch,
      powerProfile,
      weather,
      bullpen,
      market,
      history,
      recentForm
    },
    homeRunDNA: {
      pullPower: pickScore(row, ["pullPower", "pullScore"], powerProfile),
      fastballHunter: pickScore(row, ["fastballScore", "fastballHunter"], pitchMatch),
      mistakePunisher: pickScore(row, ["mistakePunisher", "damageScore", "barrelScore"], powerProfile),
      flyBallSwing: pickScore(row, ["flyBallScore", "launchScore"], recentForm),
      weatherBoost: weather,
      bullpenHunter: bullpen,
      recentForm
    },
    expected: {
      pitch: text(row.expectedPitch || row.bestPitch || "Best matchup pitch"),
      zone: text(row.expectedZone || row.damageZone || "Damage zone"),
      distance: Math.round(num(row.expectedDistance || row.projectedDistance || 410)),
      count: text(row.expectedCount || "Hitter's count")
    },
    source: {
      fromAdvancedIntelligence: true
    }
  };
}

const reports = allPlayers
  .map(buildReport)
  .filter(r => r.player)
  .sort((a,b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.probability - a.probability;
  });

const out = {
  sport: "MLB",
  market: "Home Runs",
  version: "1.2",
  updatedAt: new Date().toISOString(),
  playerCount: reports.length,
  sourceDebug: debug,
  notes: [
    "AI Reasoning Engine 1.2 reads the actual active MLB player sources currently available in website/data.",
    "Empty HR-specific files are skipped automatically.",
    "This powers AI Says and future AI player reports."
  ],
  topReports: reports.slice(0,25),
  reports
};

fs.writeFileSync(OUT, JSON.stringify(out,null,2));

console.log("AI REASONING ENGINE COMPLETE");
console.log("Players:", reports.length);
console.log("Debug:", debug);
console.log("Top:", reports[0]?.player);
console.log("Saved:", OUT);
