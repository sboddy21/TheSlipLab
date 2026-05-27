import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "website", "data");

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

function write(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

function arr(x) {
  if (Array.isArray(x)) return x;
  return x?.allPlayers || x?.players || x?.rows || x?.data || [];
}

function num(v, fallback = 0) {
  const n = Number(String(v ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function scale(v, min, max) {
  return clamp(((num(v) - min) / (max - min)) * 100);
}

function key(v) {
  return String(v || "").toLowerCase().trim();
}

function stat(row, k) {
  return num(row?.stats?.hitter?.[k] ?? row?.hitterStats?.[k] ?? row?.[k]);
}

function realHrProbability(row) {
  const hr = stat(row, "hr");
  const avg = stat(row, "avg");
  const slg = stat(row, "slg");
  const ops = stat(row, "ops");
  const iso = num(row.iso ?? Math.max(0, slg - avg));

  const archetype = num(row.hrArchetypeScore);
  const volatility = num(row.hrVolatilityScore);
  const pitch = num(row.pitchTypeDestructionScore);
  const launch = num(row.launchHrProfileScore);
  const pullWind = num(row.pullWindHrScore);
  const bullpen = num(row.bullpenInheritanceScore);
  const ceiling = num(row.multiHrCeilingScore);
  const pitcherRisk = num(row.pitcherRisk);
  const zonePower = num(row.hitterZonePower);
  const weather = num(row.weather);
  const park = num(row.parkFactor ?? row.parkBoost ?? row.hrParkFactor);

  const barrel =
    num(row.barrelRate ?? row.barrelPct ?? row.brlPct ?? row.brl) ||
    scale(iso, 0.090, 0.340) * 0.75 ||
    scale(slg, 0.360, 0.680) * 0.55;

  const hardHit =
    num(row.hardHitRate ?? row.hardHitPct ?? row.hhPct ?? row.hh) ||
    scale(ops, 0.680, 1.050) * 0.55;

  const hr7 = num(row.last7Hr ?? row.l7Hr ?? row.recentHr);
  const slg7 = num(row.last7Slg ?? row.l7Slg ?? row.slgLast7);
  const ops7 = num(row.last7Ops ?? row.l7Ops);

  const playerPower = clamp(
    scale(hr, 0, 35) * 0.24 +
    scale(iso, 0.090, 0.360) * 0.22 +
    scale(slg, 0.340, 0.700) * 0.14 +
    scale(barrel, 4, 16) * 0.18 +
    scale(hardHit, 35, 58) * 0.12 +
    archetype * 0.10
  );

  const matchupPower = clamp(
    pitcherRisk * 0.22 +
    pitch * 0.20 +
    launch * 0.18 +
    volatility * 0.16 +
    zonePower * 0.10 +
    pullWind * 0.08 +
    bullpen * 0.06
  );

  const recentPower = clamp(
    scale(hr7, 0, 4) * 0.52 +
    scale(slg7, 0.320, 0.950) * 0.28 +
    scale(ops7, 0.650, 1.250) * 0.20
  );

  const environmentPower = clamp(
    pullWind * 0.36 +
    weather * 0.24 +
    park * 0.18 +
    bullpen * 0.12 +
    pitcherRisk * 0.10
  );

  const ceilingPower = clamp(
    ceiling * 0.42 +
    archetype * 0.24 +
    launch * 0.16 +
    pitch * 0.12 +
    recentPower * 0.06
  );

  const modelScore = clamp(
    playerPower * 0.32 +
    matchupPower * 0.28 +
    ceilingPower * 0.18 +
    recentPower * 0.12 +
    environmentPower * 0.10
  );

  let probability =
    2.4 +
    modelScore * 0.205 +
    ceilingPower * 0.030 +
    pitcherRisk * 0.018 +
    archetype * 0.016;

  if (modelScore >= 88) probability += 3.2;
  else if (modelScore >= 78) probability += 2.4;
  else if (modelScore >= 68) probability += 1.6;
  else if (modelScore >= 58) probability += 0.8;

  if (ceiling >= 82) probability += 1.5;
  if (pitch >= 75) probability += 1.2;
  if (launch >= 80) probability += 1.2;
  if (pullWind >= 75) probability += 1.0;
  if (hr7 >= 2) probability += 1.0;

  probability = clamp(probability, 1.5, 31);

  return {
    realHrProbability: Math.round(probability * 10) / 10,
    realHrModelScore: Math.round(modelScore * 10) / 10,
    playerPowerComponent: Math.round(playerPower * 10) / 10,
    matchupPowerComponent: Math.round(matchupPower * 10) / 10,
    recentPowerComponent: Math.round(recentPower * 10) / 10,
    environmentPowerComponent: Math.round(environmentPower * 10) / 10,
    ceilingPowerComponent: Math.round(ceilingPower * 10) / 10,
    probabilityTier:
      probability >= 20 ? "Elite HR Probability" :
      probability >= 15 ? "Strong HR Probability" :
      probability >= 10 ? "Live HR Probability" :
      probability >= 7 ? "Playable HR Probability" :
      "Longshot HR Probability"
  };
}

function enrich(row) {
  const prob = realHrProbability(row);
  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];

  if (prob.realHrProbability >= 15) reasons.push(prob.probabilityTier);

  return {
    ...row,
    ...prob,
    hrChance: prob.realHrProbability,
    projectedHrProbability: prob.realHrProbability,
    impliedHrProbability: prob.realHrProbability,
    hrConfidence: prob.realHrProbability,
    score: prob.realHrModelScore,
    reasons
  };
}

function uniqueTop(rows, keyName, limit = 12) {
  const used = new Set();

  return [...rows]
    .sort((a, b) => num(b[keyName]) - num(a[keyName]))
    .filter(row => {
      const k = key(row.player);
      if (!k || used.has(k)) return false;
      used.add(k);
      return true;
    })
    .slice(0, limit);
}

function rebuildSections(rows) {
  return {
    bestPicks: uniqueTop(rows, "realHrProbability"),
    safestPlays: uniqueTop(rows, "playerPowerComponent"),
    bestValue: uniqueTop(rows.filter(r => num(r.realHrProbability) >= 7), "realHrProbability"),
    lottoBombs: uniqueTop(rows, "multiHrCeilingScore"),
    pitchTypeEdges: uniqueTop(rows.filter(r => num(r.pitchTypeDestructionScore) > 0), "pitchTypeDestructionScore"),
    weatherCarry: uniqueTop(rows.filter(r => num(r.pullWindHrScore) > 0), "pullWindHrScore"),
    bullpenBoosts: uniqueTop(rows.filter(r => num(r.bullpenInheritanceScore) > 0), "bullpenInheritanceScore")
  };
}

const homeRuns = read("mlb_home_runs.json", []);

if (Array.isArray(homeRuns)) {
  const rows = homeRuns
    .map(enrich)
    .sort((a, b) => num(b.realHrProbability) - num(a.realHrProbability))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  write("mlb_home_runs.json", rows);
  console.log("Updated mlb_home_runs.json:", rows.length);
}

const dc = read("hr_decision_center.json", null);

if (dc?.allPlayers) {
  const rows = dc.allPlayers
    .map(enrich)
    .sort((a, b) => num(b.realHrProbability) - num(a.realHrProbability));

  write("hr_decision_center.json", {
    ...dc,
    updatedAt: new Date().toISOString(),
    realHrProbabilityUpdatedAt: new Date().toISOString(),
    scoringMode: "Real HR probability",
    sections: rebuildSections(rows),
    allPlayers: rows
  });

  console.log("Updated hr_decision_center.json:", rows.length);
}

const cardData = read("player_card_data.json", null);

if (cardData) {
  const rows = arr(cardData).map(enrich);

  if (Array.isArray(cardData)) write("player_card_data.json", rows);
  else if (cardData.players) write("player_card_data.json", { ...cardData, players: rows });

  console.log("Updated player_card_data.json:", rows.length);
}

console.log("REAL HR PROBABILITY ENGINE COMPLETE");
