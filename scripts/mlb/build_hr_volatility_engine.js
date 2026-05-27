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

  if (text.includes("hot")) score += 18;
  if (text.includes("due")) score += 12;
  if (text.includes("hr")) score += 10;
  if (text.includes("barrel")) score += 10;
  if (text.includes("hard")) score += 8;

  score += num(row.last7Hr ?? row.l7Hr ?? row.recentHr) * 12;
  score += scale(row.last7Ops ?? row.l7Ops, 0.650, 1.100) * 0.35;

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

function environment(row) {
  return clamp(
    num(row.weather) * 0.45 +
    num(row.parkFactor ?? row.parkBoost ?? row.hrParkFactor) * 0.35 +
    num(row.bullpen) * 0.20
  );
}

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

  const barrelScore = clamp(barrel * 6.8);
  const hardHitScore = clamp(hardHit * 1.65);
  const rawPower = clamp(
    scale(hr, 0, 30) * 0.32 +
    scale(slg, 0.330, 0.620) * 0.28 +
    scale(ops, 0.650, 1.000) * 0.18 +
    scale(iso, 0.090, 0.320) * 0.22
  );

  const pitchScore = pitchPunishment(row);
  const leakScore = hrLeak(row);
  const recent = recentScore(row);
  const env = environment(row);

  const score = clamp(
    barrelScore * 0.30 +
    hardHitScore * 0.22 +
    pitchScore * 0.18 +
    recent * 0.13 +
    leakScore * 0.10 +
    zonePower * 0.05 +
    env * 0.02
  );

  const current = num(row.hrConfidence ?? row.score ?? row.powerScore, 0);
  const finalScore = clamp(current * 0.15 + score * 0.85);

  return {
    ...row,
    barrelScore: Math.round(barrelScore * 10) / 10,
    hardHitScore: Math.round(hardHitScore * 10) / 10,
    pitchPunishment: Math.round(pitchScore * 10) / 10,
    hrLeakFactor: Math.round(leakScore * 10) / 10,
    hotZoneAttack: Math.round(zonePower * 10) / 10,
    recentHRTrend: Math.round(recent * 10) / 10,
    hrEnvironmentScore: Math.round(env * 10) / 10,
    hrVolatilityScore: Math.round(score * 10) / 10,
    oldScore: current,
    score: Math.round(finalScore),
    hrConfidence: Math.round(finalScore * 10) / 10,
    volatilityTier:
      finalScore >= 58 ? "Nuclear" :
      finalScore >= 48 ? "Explosive" :
      finalScore >= 40 ? "Strong HR Spot" :
      finalScore >= 32 ? "Live HR Spot" :
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
      currentModel: 15,
      hrVolatility: 85
    },
    sections: rebuildDecisionSections(rows),
    allPlayers: rows
  };

  write("hr_decision_center.json", output);
  console.log("Updated hr_decision_center.json:", rows.length);
}

console.log("HR VOLATILITY ENGINE COMPLETE");
