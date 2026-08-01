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

function finite(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rounded(v, digits = 1) {
  const n = finite(v);
  if (n === null) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
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

function pickScore(row, keys) {
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
  return null;
}

function signal(key, label, detail, value, source, severity = "support") {
  return { key, label, detail, value: rounded(value), source, severity };
}

function buildSupportingSignals(row, probability) {
  const out = [];
  const power = finite(row.hrPowerIndex);
  const contactDamage = finite(row.contactDamageScore);
  const launchPower = finite(row.launchPowerScore);
  const recentForm = finite(row.breakdown?.trend);

  if (probability !== null && probability >= 20) {
    out.push(signal("hr_probability", "Top-tier HR probability", `${probability}% tracked HR probability (${text(row.probabilityTier, "unclassified")}).`, probability, "hr_probability_tracking.json"));
  } else if (probability !== null && probability >= 15) {
    out.push(signal("hr_probability", "Viable HR probability", `${probability}% tracked HR probability (${text(row.probabilityTier, "unclassified")}).`, probability, "hr_probability_tracking.json"));
  }
  if (power !== null && power >= 55) {
    out.push(signal("power_profile", power >= 70 ? "Impact power" : "Power support", `${rounded(power)} HR Power Index (${text(row.powerTier, "unclassified").replaceAll("_", " ")}).`, power, "hr_power_profiles.json"));
  }
  if (contactDamage !== null && contactDamage >= 55) {
    out.push(signal("contact_damage", "Authoritative contact", `${rounded(contactDamage)} contact-damage score in the current power profile.`, contactDamage, "hr_power_profiles.json"));
  }
  if (launchPower !== null && launchPower >= 50) {
    out.push(signal("launch_power", "Launch-angle power", `${rounded(launchPower)} launch-power score supports home-run damage.`, launchPower, "hr_power_profiles.json"));
  }
  if (recentForm !== null && recentForm >= 62) {
    out.push(signal("recent_form_streak", recentForm >= 78 ? "Hot recent-form streak" : "Recent-form support", `${rounded(recentForm, 0)} recent-form trend score is helping the player-card read.`, recentForm, "ai_trust_engine.json"));
  }

  return out.slice(0, 6);
}

function buildCounterSignals(row, probability) {
  const out = [];
  const power = finite(row.hrPowerIndex);
  const contactDamage = finite(row.contactDamageScore);
  const launchPower = finite(row.launchPowerScore);
  const strikeoutRate = finite(row.rates?.strikeoutRate);
  const samplePenalty = finite(row.samplePenalty);
  const recentForm = finite(row.breakdown?.trend);

  if (probability !== null && probability < 10) {
    out.push(signal("low_hr_probability", "Longshot base rate", `${probability}% tracked HR probability (${text(row.probabilityTier, "unclassified")}).`, probability, "hr_probability_tracking.json", "high"));
  } else if (probability !== null && probability < 15) {
    out.push(signal("modest_hr_probability", "Modest base probability", `${probability}% tracked HR probability; below the model's top probability tier.`, probability, "hr_probability_tracking.json", "moderate"));
  }

  if (text(row.powerTier) === "LOW_POWER" || (power !== null && power < 45)) {
    out.push(signal("limited_power", "Limited raw-power support", `${rounded(power)} HR Power Index (${text(row.powerTier, "unclassified").replaceAll("_", " ")}).`, power, "hr_power_profiles.json", "high"));
  }
  if (strikeoutRate !== null && strikeoutRate >= 28) {
    out.push(signal("contact_risk", "Contact risk", `${rounded(strikeoutRate)}% strikeout rate can reduce damage opportunities.`, strikeoutRate, "hr_power_profiles.json", strikeoutRate >= 32 ? "high" : "moderate"));
  }
  if (samplePenalty !== null && samplePenalty > 0) {
    out.push(signal("sample_penalty", "Limited sample confidence", `${rounded(samplePenalty)}-point sample penalty is active in the power profile.`, samplePenalty, "hr_power_profiles.json", "moderate"));
  }
  if (contactDamage !== null && contactDamage < 45) {
    out.push(signal("limited_contact_damage", "Contact quality concern", `${rounded(contactDamage)} contact-damage score limits the supporting power case.`, contactDamage, "hr_power_profiles.json", contactDamage < 30 ? "high" : "moderate"));
  }
  if (launchPower !== null && launchPower < 35) {
    out.push(signal("limited_launch_power", "Launch profile concern", `${rounded(launchPower)} launch-power score is below the stronger home-run profiles.`, launchPower, "hr_power_profiles.json", launchPower < 20 ? "high" : "moderate"));
  }
  if (recentForm !== null && recentForm < 35) {
    out.push(signal("cold_recent_form", "Cold recent-form signal", `${rounded(recentForm, 0)} recent-form trend score is not helping the profile today.`, recentForm, "ai_trust_engine.json", recentForm < 22 ? "high" : "moderate"));
  }

  const seen = new Set();
  return out.filter(item => {
    const key = `${item.key}|${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function buildWhy(row, supportingSignals) {
  const reasons = supportingSignals.map(item => item.detail);
  if (!reasons.length) reasons.push("No supporting signal crossed the current explanation threshold.");
  return [...new Set(reasons)].slice(0, 6);
}

function verdict(confidence, probability) {
  if (probability !== null && probability < 10) return "High-Variance Longshot";
  if (probability !== null && probability < 15) return "Speculative HR Target";
  if (confidence >= 88 && probability >= 20) return "Elite AI Play";
  if (confidence >= 80 && probability >= 16) return "Strong AI Play";
  if (confidence >= 72) return "Playable HR Target";
  if (confidence >= 62) return "Lean / Watch List";
  return "Volatile Longshot";
}

function buildReport(row) {
  const probability = pickScore(row, ["realHrProbability", "hrProbability", "probability", "hrChance", "hrProb", "modelProbability"]);
  const breakdown = row.breakdown || {};
  const confidence = rounded(row.trustScore, 0);
  const supportingSignals = buildSupportingSignals(row, probability);
  const counterSignals = buildCounterSignals(row, probability);
  const whyToday = buildWhy(row, supportingSignals);
  const riskFactors = [
    ...counterSignals.map(item => item.detail),
    "Home runs remain high-variance outcomes even when several independent signals agree."
  ].slice(0, 7);

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
    supportingSignals,
    counterSignals,
    trustBreakdown: {
      modelAgreement: rounded(row.trustScore, 0),
      pitchMatch: rounded(breakdown.matchup, 0),
      powerProfile: rounded(breakdown.power, 0),
      environment: rounded(breakdown.environment, 0),
      pitchMix: rounded(breakdown.pitchMix, 0),
      consensus: rounded(breakdown.consensus, 0),
      recentForm: rounded(breakdown.trend, 0),
      bullpen: null,
      market: null,
      history: null
    },
    homeRunDNA: {
      hrPowerIndex: rounded(row.hrPowerIndex),
      truePowerScore: rounded(row.truePowerScore),
      contactDamageScore: rounded(row.contactDamageScore),
      launchPowerScore: rounded(row.launchPowerScore),
      strikeoutRate: rounded(row.rates?.strikeoutRate),
      powerTier: text(row.powerTier) || null,
      recentForm: rounded(breakdown.trend, 0)
    },
    expected: {
      pitch: text(row.expectedPitch || row.bestPitch) || null,
      zone: text(row.expectedZone || row.damageZone) || null,
      distance: rounded(row.expectedDistance ?? row.projectedDistance, 0),
      count: text(row.expectedCount) || null
    },
    source: {
      files: SOURCE_FILES
    }
  };
}

const reports = allPlayers
  .map(buildReport)
  .filter(r => r.player && r.probability !== null && r.confidence !== null)
  .sort((a,b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.probability - a.probability;
  });

const out = {
  sport: "MLB",
  market: "Home Runs",
  version: "1.3",
  updatedAt: new Date().toISOString(),
  playerCount: reports.length,
  sourceDebug: debug,
  notes: [
    "AI Reasoning Engine 1.3 reads only the active MLB player sources listed in sourceDebug.",
    "Supporting and counter-signals are emitted only when a verified source field is present.",
    "Missing signals remain null and do not receive neutral default scores."
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
