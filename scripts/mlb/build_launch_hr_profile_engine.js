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

function bestZone(row, names) {
  let best = 0;

  for (const name of names) {
    const values = row?.[name];
    if (!Array.isArray(values)) continue;

    for (const value of values) {
      best = Math.max(best, num(value));
    }
  }

  return best;
}

function launchProfileScore(row) {
  const hr = stat(row, "hr");
  const avg = stat(row, "avg");
  const slg = stat(row, "slg");
  const ops = stat(row, "ops");
  const iso = num(row.iso ?? Math.max(0, slg - avg));

  const archetype = num(row.hrArchetypeScore);
  const pitchDestroy = num(row.pitchTypeDestructionScore);
  const pullWind = num(row.pullWindHrScore);
  const zonePower = bestZone(row, ["hrZones"]) * 18 + bestZone(row, ["slgZones"]) * 65 + bestZone(row, ["isoZones"]) * 115;

  const flyballProxy = clamp(
    scale(hr, 0, 30) * 0.34 +
    scale(iso, 0.090, 0.340) * 0.30 +
    scale(slg, 0.350, 0.700) * 0.18 +
    scale(ops, 0.720, 1.100) * 0.08 +
    clamp(zonePower) * 0.10
  );

  const liftProfile = clamp(
    archetype * 0.36 +
    flyballProxy * 0.30 +
    pitchDestroy * 0.14 +
    pullWind * 0.12 +
    clamp(zonePower) * 0.08
  );

  return liftProfile;
}

function tag(score) {
  if (score >= 82) return "Elite Lift HR Profile";
  if (score >= 68) return "Strong Lift HR Profile";
  if (score >= 52) return "Playable Lift";
  if (score >= 38) return "Some Lift";
  return "Low Lift";
}

function enrich(row) {
  const score = launchProfileScore(row);

  const bonus =
    score >= 82 ? 8 :
    score >= 68 ? 6 :
    score >= 52 ? 4 :
    score >= 38 ? 2 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const next = clamp(base + bonus);

  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];
  if (bonus > 0) reasons.push(tag(score));

  return {
    ...row,
    score: Math.round(next * 10) / 10,
    hrConfidence: Math.round(next * 10) / 10,
    launchHrProfileScore: Math.round(score * 10) / 10,
    launchHrTag: tag(score),
    launchHrBonus: bonus,
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
    bullpenBoosts: uniqueTop(rows.filter(r => num(r.bullpen) > 0), "bullpen")
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
    launchHrProfileUpdatedAt: new Date().toISOString(),
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

console.log("LAUNCH HR PROFILE ENGINE COMPLETE");
