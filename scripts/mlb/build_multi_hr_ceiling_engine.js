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

function clamp(v) {
  return Math.max(0, Math.min(100, v));
}

function key(v) {
  return String(v || "").toLowerCase().trim();
}

function scale(v, min, max) {
  return clamp(((num(v) - min) / (max - min)) * 100);
}

function stat(row, k) {
  return num(row?.stats?.hitter?.[k] ?? row?.hitterStats?.[k] ?? row?.[k]);
}

function recentHr(row) {
  return num(row.last7Hr ?? row.l7Hr ?? row.recentHr);
}

function ceilingScore(row) {
  const hr = stat(row, "hr");
  const avg = stat(row, "avg");
  const slg = stat(row, "slg");
  const iso = num(row.iso ?? Math.max(0, slg - avg));

  const archetype = num(row.hrArchetypeScore);
  const pitchDestroy = num(row.pitchTypeDestructionScore);
  const launch = num(row.launchHrProfileScore);
  const pullWind = num(row.pullWindHrScore);
  const bullpen = num(row.bullpenInheritanceScore);
  const lineup = num(row.lineupAttackBoost);
  const volatility = num(row.hrVolatilityScore);
  const hr7 = recentHr(row);

  const seasonPower = clamp(
    scale(hr, 0, 35) * 0.58 +
    scale(iso, 0.100, 0.360) * 0.42
  );

  const recentNuke =
    hr7 >= 4 ? 100 :
    hr7 >= 3 ? 85 :
    hr7 >= 2 ? 68 :
    hr7 >= 1 ? 42 :
    0;

  return clamp(
    archetype * 0.24 +
    launch * 0.18 +
    pitchDestroy * 0.16 +
    seasonPower * 0.14 +
    volatility * 0.12 +
    recentNuke * 0.08 +
    pullWind * 0.04 +
    bullpen * 0.025 +
    lineup * 0.015
  );
}

function tag(score) {
  if (score >= 82) return "Slate Breaker";
  if (score >= 68) return "Multi HR Ceiling";
  if (score >= 54) return "Nuclear Upside";
  if (score >= 40) return "One Swing Plus";
  return "Standard HR Upside";
}

function enrich(row) {
  const score = ceilingScore(row);

  const bonus =
    score >= 82 ? 8 :
    score >= 68 ? 6 :
    score >= 54 ? 4 :
    score >= 40 ? 2 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const next = clamp(base + bonus);

  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];
  if (bonus > 0) reasons.push(tag(score));

  return {
    ...row,
    score: Math.round(next * 10) / 10,
    hrConfidence: Math.round(next * 10) / 10,
    multiHrCeilingScore: Math.round(score * 10) / 10,
    multiHrCeilingTag: tag(score),
    multiHrCeilingBonus: bonus,
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
    bestPicks: uniqueTop(rows, "hrConfidence"),
    safestPlays: uniqueTop(rows, "powerScore"),
    bestValue: uniqueTop(rows.filter(r => num(r.hrVolatilityScore) >= 35 && num(r.powerScore) <= 60), "hrVolatilityScore"),
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
    .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  write("mlb_home_runs.json", rows);
  console.log("Updated mlb_home_runs.json:", rows.length);
}

const dc = read("hr_decision_center.json", null);

if (dc?.allPlayers) {
  const rows = dc.allPlayers
    .map(enrich)
    .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence));

  write("hr_decision_center.json", {
    ...dc,
    updatedAt: new Date().toISOString(),
    multiHrCeilingUpdatedAt: new Date().toISOString(),
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

console.log("MULTI HR CEILING ENGINE COMPLETE");
