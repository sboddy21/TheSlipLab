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

function bullpenRows() {
  return arr(read("bullpen_collapse_engine.json", []));
}

function findBullpen(row, rows) {
  const opp = key(row.opponent);
  return rows.find(r =>
    key(r.team) === opp ||
    key(r.Team) === opp ||
    key(r.opponent) === opp
  ) || {};
}

function bullpenScore(row, bullpen) {
  const bullpenRisk =
    num(row.bullpen) ||
    num(bullpen.collapseScore) ||
    num(bullpen.dangerScore) ||
    num(bullpen.hrRiskScore) ||
    num(bullpen.bullpenScore);

  const pitcherRisk = num(row.pitcherRisk);
  const hrLeak = num(row.hrLeakFactor);
  const archetype = num(row.hrArchetypeScore);
  const latePower = num(row.launchHrProfileScore);

  return clamp(
    bullpenRisk * 0.38 +
    pitcherRisk * 0.18 +
    hrLeak * 0.14 +
    archetype * 0.16 +
    latePower * 0.14
  );
}

function tag(score) {
  if (score >= 75) return "Late Game HR Spike";
  if (score >= 60) return "Bullpen HR Boost";
  if (score >= 45) return "Late Game Edge";
  if (score >= 30) return "Small Bullpen Edge";
  return "Neutral";
}

function enrich(row, bullpenData) {
  const bp = findBullpen(row, bullpenData);
  const score = bullpenScore(row, bp);

  const bonus =
    score >= 75 ? 7 :
    score >= 60 ? 5 :
    score >= 45 ? 3 :
    score >= 30 ? 1.5 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const next = clamp(base + bonus);

  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];
  if (bonus > 0) reasons.push(tag(score));

  return {
    ...row,
    score: Math.round(next * 10) / 10,
    hrConfidence: Math.round(next * 10) / 10,
    bullpenInheritanceScore: Math.round(score * 10) / 10,
    bullpenInheritanceTag: tag(score),
    bullpenInheritanceBonus: bonus,
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
    lottoBombs: uniqueTop(rows, "hrVolatilityScore"),
    pitchTypeEdges: uniqueTop(rows.filter(r => num(r.pitchTypeDestructionScore) > 0), "pitchTypeDestructionScore"),
    weatherCarry: uniqueTop(rows.filter(r => num(r.pullWindHrScore) > 0), "pullWindHrScore"),
    bullpenBoosts: uniqueTop(rows.filter(r => num(r.bullpenInheritanceScore) > 0), "bullpenInheritanceScore")
  };
}

const bp = bullpenRows();
const homeRuns = read("mlb_home_runs.json", []);

if (Array.isArray(homeRuns)) {
  const rows = homeRuns
    .map(row => enrich(row, bp))
    .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  write("mlb_home_runs.json", rows);
  console.log("Updated mlb_home_runs.json:", rows.length);
}

const dc = read("hr_decision_center.json", null);

if (dc?.allPlayers) {
  const rows = dc.allPlayers
    .map(row => enrich(row, bp))
    .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence));

  write("hr_decision_center.json", {
    ...dc,
    updatedAt: new Date().toISOString(),
    bullpenInheritanceUpdatedAt: new Date().toISOString(),
    sections: rebuildSections(rows),
    allPlayers: rows
  });

  console.log("Updated hr_decision_center.json:", rows.length);
}

const cardData = read("player_card_data.json", null);

if (cardData) {
  const rows = arr(cardData).map(row => enrich(row, bp));

  if (Array.isArray(cardData)) write("player_card_data.json", rows);
  else if (cardData.players) write("player_card_data.json", { ...cardData, players: rows });

  console.log("Updated player_card_data.json:", rows.length);
}

console.log("BULLPEN INHERITANCE ENGINE COMPLETE");
