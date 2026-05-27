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

function num(v, fallback = 0) {
  const n = Number(String(v ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v) {
  return Math.max(0, Math.min(100, v));
}

function scale(v, min, max) {
  return clamp(((num(v) - min) / (max - min)) * 100);
}

function stat(row, key, fallback = 0) {
  return num(
    row?.stats?.hitter?.[key] ??
    row?.hitterStats?.[key] ??
    row?.[key],
    fallback
  );
}

function bestZone(row, keys) {
  let best = 0;

  for (const key of keys) {
    const values = row?.[key];
    if (!Array.isArray(values)) continue;

    for (const value of values) {
      best = Math.max(best, num(value));
    }
  }

  return best;
}

function recentScore(row) {
  const text = [
    row.note,
    row.why,
    row.reason,
    Array.isArray(row.reasons) ? row.reasons.join(" ") : ""
  ].filter(Boolean).join(" ").toLowerCase();

  let score = 0;

  if (text.includes("hot")) score += 26;
  if (text.includes("due")) score += 18;
  if (text.includes("hr")) score += 14;
  if (text.includes("barrel")) score += 16;
  if (text.includes("hard")) score += 12;
  if (text.includes("pull")) score += 10;
  if (text.includes("flyball")) score += 10;
  if (text.includes("crush")) score += 14;

  const hr7 = num(row.last7Hr ?? row.l7Hr ?? row.recentHr);
  const slg7 = num(row.last7Slg ?? row.l7Slg ?? row.slgLast7);
  const ops7 = num(row.last7Ops ?? row.l7Ops);

  score += hr7 * 20;
  score += scale(slg7, 0.320, 0.950) * 0.65;
  score += scale(ops7, 0.650, 1.300) * 0.45;

  return clamp(score);
}

function pitchPunishment(row) {
  return clamp(
    num(row.pitchEdge) * 0.42 +
    num(row.bestPitchScore) * 0.18 +
    num(row.zoneOverlap) * 0.22 +
    num(row.hotZoneCount) * 4.5
  );
}

function hrLeak(row) {
  return clamp(
    num(row.pitcherRisk) * 0.55 +
    num(row.pitcherLeak) * 0.25 +
    num(row.bullpen) * 0.20
  );
}


function lineupAttackBoost(row, allRows) {
  const pitcher =
    row.opposingPitcher ||
    row.pitcher ||
    row.vsPitcher ||
    "";

  if (!pitcher) return 0;

  const samePitcher = allRows.filter(r => {
    const p =
      r.opposingPitcher ||
      r.pitcher ||
      r.vsPitcher ||
      "";

    return p === pitcher;
  });

  if (!samePitcher.length) return 0;

  const avgLeak =
    samePitcher.reduce((sum, r) => {
      return sum + num(r.pitcherRisk ?? r.pitcherLeak ?? 0);
    }, 0) / samePitcher.length;

  const strongBats = samePitcher.filter(r => {
    const hr = stat(r, "hr");
    const iso = num(r.iso ?? 0);
    return hr >= 5 || iso >= .170;
  }).length;

  const archetypes = samePitcher.filter(r => {
    return num(r.hrArchetypeScore ?? 0) >= 40;
  }).length;

  let boost = 0;

  // weak pitcher environment
  boost += scale(avgLeak, 20, 80) * 0.45;

  // many power bats attacking same pitcher
  boost += strongBats * 4.5;

  // multiple HR archetypes in lineup
  boost += archetypes * 6;

  // full stack attack
  if (strongBats >= 4) boost += 12;
  if (archetypes >= 3) boost += 14;

  return clamp(boost);
}

function environment(row) {
  return clamp(
    num(row.weather) * 0.45 +
    num(row.parkFactor ?? row.parkBoost ?? row.hrParkFactor) * 0.35 +
    num(row.bullpen) * 0.20
  );
}


function hrArchetype(row) {
  const hr = stat(row, "hr");
  const avg = stat(row, "avg");
  const slg = stat(row, "slg");
  const ops = stat(row, "ops");
  const iso = num(row.iso ?? Math.max(0, slg - avg));

  const barrel =
    num(row.barrelRate ?? row.barrelPct ?? row.brlPct ?? row.brl);

  const hh =
    num(row.hardHitRate ?? row.hardHitPct ?? row.hhPct ?? row.hh);

  const hr7 = num(row.last7Hr ?? row.l7Hr ?? row.recentHr);

  let score = 0;

  // Pure HR hitters
  if (hr >= 12) score += 26;
  else if (hr >= 8) score += 18;
  else if (hr >= 5) score += 10;

  // Low AVG + high power archetype
  if (avg <= .255 && iso >= .185) score += 18;
  if (avg <= .245 && slg >= .440) score += 12;

  // Barrel monsters
  if (barrel >= 14) score += 24;
  else if (barrel >= 11) score += 18;
  else if (barrel >= 8) score += 10;

  // Hard hit power profile
  if (hh >= 52) score += 16;
  else if (hh >= 47) score += 10;

  // Hot HR streaks
  if (hr7 >= 4) score += 24;
  else if (hr7 >= 3) score += 18;
  else if (hr7 >= 2) score += 12;

  // Three true outcome style boost
  if (ops < .820 && iso >= .210) score += 14;

  // Schwarber/Burger/Olson type profile
  if (
    avg <= .255 &&
    slg >= .430 &&
    hr >= 8
  ) {
    score += 22;
  }

  return clamp(score);
}

let hrRowsGlobal = [];

function volatility(row) {
  const hr = stat(row, "hr");
  const slg = stat(row, "slg");
  const ops = stat(row, "ops");
  const iso = num(row.iso ?? row.ISO ?? Math.max(0, slg - stat(row, "avg")));

  const barrel =
    num(row.barrelRate ?? row.barrelPct ?? row.brl ?? row.brlPct) ||
    scale(iso, 0.090, 0.320) * 0.75 ||
    scale(slg, 0.340, 0.620) * 0.70;

  const hardHit =
    num(row.hardHitRate ?? row.hardHitPct ?? row.hh ?? row.hhPct) ||
    scale(ops, 0.650, 0.950) * 0.65;

  const zonePower = clamp(
    bestZone(row, ["isoZones"]) * 135 +
    bestZone(row, ["slgZones"]) * 55 +
    bestZone(row, ["hrZones"]) * 10
  );

  const barrelScore = clamp(barrel * 8.8);
  const hardHitScore = clamp(hardHit * 2.25);
  const hrScore = scale(hr, 0, 30);
  const isoScore = scale(iso, 0.090, 0.340);

  const rawPower = clamp(
    hrScore * 0.48 +
    isoScore * 0.32 +
    scale(slg, 0.360, 0.700) * 0.14 +
    scale(ops, 0.720, 1.100) * 0.06
  );

  const pitchScore = pitchPunishment(row);
  const leakScore = hrLeak(row);
  const recent = recentScore(row);
  const env = environment(row);

  const archetype = hrArchetype(row);

  const rawLineupBoost = lineupAttackBoost(row, hrRowsGlobal);
  const lineupMultiplier =
    archetype >= 70 ? 1.00 :
    archetype >= 50 ? 0.70 :
    archetype >= 35 ? 0.45 :
    0.18;

  const lineupBoost = rawLineupBoost * lineupMultiplier;

  const hr7 = num(row.last7Hr ?? row.l7Hr ?? row.recentHr);
  const hotHrBoost =
    hr7 >= 4 ? 24 :
    hr7 >= 3 ? 18 :
    hr7 >= 2 ? 12 :
    hr7 >= 1 ? 6 : 0;

  const score = clamp(
    archetype * 0.28 +
    barrelScore * 0.24 +
    hardHitScore * 0.18 +
    rawPower * 0.16 +
    recent * 0.10 +
    pitchScore * 0.06 +
    lineupBoost * 0.03 +
    hotHrBoost * 0.01 +
    leakScore * 0.005 +
    env * 0.005
  );

  const current = num(row.hrConfidence ?? row.score ?? row.powerScore, 0);
  const finalScore = clamp(current * 0.03 + score * 0.97);

  return {
    ...row,
    barrelScore: Math.round(barrelScore * 10) / 10,
    hardHitScore: Math.round(hardHitScore * 10) / 10,
    pitchPunishment: Math.round(pitchScore * 10) / 10,
    hrLeakFactor: Math.round(leakScore * 10) / 10,
    hotZoneAttack: Math.round(zonePower * 10) / 10,
    recentHRTrend: Math.round(recent * 10) / 10,
    hrEnvironmentScore: Math.round(env * 10) / 10,
    rawLineupAttackBoost: Math.round(rawLineupBoost * 10) / 10,
    lineupAttackBoost: Math.round(lineupBoost * 10) / 10,
    hrArchetypeScore: Math.round(archetype * 10) / 10,
    hrVolatilityScore: Math.round(score * 10) / 10,
    oldScore: current,
    score: Math.round(finalScore),
    hrConfidence: Math.round(finalScore * 10) / 10,
    volatilityTier:
      finalScore >= 54 ? "Nuclear" :
      finalScore >= 45 ? "Explosive" :
      finalScore >= 36 ? "Strong HR Spot" :
      finalScore >= 28 ? "Live HR Spot" :
      "Watchlist"
  };
}

function uniqueTop(rows, key, limit = 12) {
  const used = new Set();

  return [...rows]
    .sort((a, b) => num(b[key]) - num(a[key]))
    .filter(row => {
      const k = String(row.player || "").toLowerCase();
      if (!k || used.has(k)) return false;
      used.add(k);
      return true;
    })
    .slice(0, limit);
}

function rebuildDecisionSections(rows) {
  return {
    bestPicks: uniqueTop(rows, "hrConfidence"),
    safestPlays: uniqueTop(rows, "powerScore"),
    bestValue: uniqueTop(
      rows.filter(row => num(row.hrVolatilityScore) >= 35 && num(row.powerScore) <= 60),
      "hrVolatilityScore"
    ),
    lottoBombs: uniqueTop(rows, "hrVolatilityScore"),
    pitchTypeEdges: uniqueTop(rows.filter(row => num(row.pitchEdge) > 0), "pitchEdge"),
    weatherCarry: uniqueTop(rows.filter(row => num(row.weather) > 0), "weather"),
    bullpenBoosts: uniqueTop(rows.filter(row => num(row.bullpen) > 0), "bullpen")
  };
}

const hrRows = read("mlb_home_runs.json", []);
if (Array.isArray(hrRows)) {
  hrRowsGlobal = hrRows;

  const fixed = hrRows.map(volatility).sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence));
  write("mlb_home_runs.json", fixed.map((row, index) => ({ ...row, rank: index + 1 })));
  console.log("Updated mlb_home_runs.json:", fixed.length);
}

const dc = read("hr_decision_center.json", null);
if (dc?.allPlayers) {
  const rows = dc.allPlayers.map(volatility).sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence));

  const output = {
    ...dc,
    updatedAt: new Date().toISOString(),
    scoringMode: "HR volatility weighted",
    volatilityWeights: {
      currentModel: 3,
      hrVolatility: 97
    },
    sections: rebuildDecisionSections(rows),
    allPlayers: rows
  };

  write("hr_decision_center.json", output);
  console.log("Updated hr_decision_center.json:", rows.length);
}

console.log("HR VOLATILITY ENGINE COMPLETE");
