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

function key(v) {
  return String(v || "").toLowerCase().trim();
}

function arr(x) {
  if (Array.isArray(x)) return x;
  return x?.allPlayers || x?.players || x?.rows || x?.data || [];
}

function playerLookup(store, row) {
  const players = store?.players || store || {};
  return (
    players[String(row.playerId || "")] ||
    players[row.player] ||
    players[key(row.player)] ||
    null
  );
}

function damageRows(row, pitchDamageData) {
  const found = playerLookup(pitchDamageData, row);
  const damage = found?.pitchDamage || found?.damage || found?.pitches || {};

  if (Array.isArray(damage)) return damage;

  return Object.values(damage).filter(Boolean);
}

function pitchScore(pitch) {
  const avg = num(pitch.avg);
  const slg = num(pitch.slg);
  const iso = num(pitch.iso);
  const hr = num(pitch.hr ?? pitch.homeRuns);
  const crush = num(pitch.crush ?? pitch.crushScore);
  const whiff = num(pitch.whiff ?? pitch.whiffRate);

  let score = 0;

  score += clamp(((slg - 0.350) / 0.350) * 100) * 0.32;
  score += clamp(((iso - 0.120) / 0.260) * 100) * 0.22;
  score += clamp((hr / 6) * 100) * 0.18;
  score += clamp(crush) * 0.18;
  score += clamp(((avg - 0.220) / 0.140) * 100) * 0.06;
  score += clamp(whiff) * 0.04;

  return clamp(score);
}

function classify(score) {
  if (score >= 78) return "Pitch Destroyer";
  if (score >= 64) return "Pitch Crusher";
  if (score >= 50) return "Pitch Edge";
  if (score >= 35) return "Pitch Lean";
  return "Neutral";
}

function enrichRow(row, pitchDamageData) {
  const pitches = damageRows(row, pitchDamageData);

  if (!pitches.length) {
    return {
      ...row,
      pitchTypeDestructionScore: 0,
      pitchTypeDestructionPitch: row.bestPitch || "",
      pitchTypeDestructionTag: "Neutral",
      pitchTypeDestructionReason: "Pitch type damage is still building."
    };
  }

  const ranked = pitches
    .map(pitch => ({
      pitch,
      score: pitchScore(pitch)
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const bestPitch =
    best.pitch.label ||
    best.pitch.pitch ||
    best.pitch.type ||
    row.bestPitch ||
    "Best pitch";

  const destruction = Math.round(best.score * 10) / 10;
  const tag = classify(destruction);

  const bonus =
    destruction >= 78 ? 8 :
    destruction >= 64 ? 6 :
    destruction >= 50 ? 4 :
    destruction >= 35 ? 2 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const newScore = clamp(base + bonus);

  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];
  if (bonus > 0) {
    reasons.push(`${tag} vs ${bestPitch}`);
  }

  return {
    ...row,
    score: Math.round(newScore * 10) / 10,
    hrConfidence: Math.round(newScore * 10) / 10,
    pitchTypeDestructionScore: destruction,
    pitchTypeDestructionPitch: bestPitch,
    pitchTypeDestructionTag: tag,
    pitchTypeDestructionBonus: bonus,
    pitchTypeDestructionReason: `${tag} profile against ${bestPitch}`,
    bestPitch: row.bestPitch || bestPitch,
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
    bestValue: uniqueTop(
      rows.filter(row => num(row.hrVolatilityScore) >= 35 && num(row.powerScore) <= 60),
      "hrVolatilityScore"
    ),
    lottoBombs: uniqueTop(rows, "hrVolatilityScore"),
    pitchTypeEdges: uniqueTop(rows.filter(row => num(row.pitchTypeDestructionScore) > 0), "pitchTypeDestructionScore"),
    weatherCarry: uniqueTop(rows.filter(row => num(row.weather) > 0), "weather"),
    bullpenBoosts: uniqueTop(rows.filter(row => num(row.bullpen) > 0), "bullpen")
  };
}

const pitchDamage = read("pitch_type_damage.json", {});
const homeRuns = read("mlb_home_runs.json", []);

if (Array.isArray(homeRuns)) {
  const enriched = homeRuns
    .map(row => enrichRow(row, pitchDamage))
    .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  write("mlb_home_runs.json", enriched);
  console.log("Updated mlb_home_runs.json:", enriched.length);
}

const dc = read("hr_decision_center.json", null);

if (dc?.allPlayers) {
  const rows = dc.allPlayers
    .map(row => enrichRow(row, pitchDamage))
    .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence));

  write("hr_decision_center.json", {
    ...dc,
    updatedAt: new Date().toISOString(),
    pitchTypeDestructionUpdatedAt: new Date().toISOString(),
    sections: rebuildSections(rows),
    allPlayers: rows
  });

  console.log("Updated hr_decision_center.json:", rows.length);
}

const cardData = read("player_card_data.json", null);

if (cardData) {
  const rows = arr(cardData).map(row => enrichRow(row, pitchDamage));

  if (Array.isArray(cardData)) {
    write("player_card_data.json", rows);
  } else if (cardData.players) {
    write("player_card_data.json", { ...cardData, players: rows });
  } else {
    write("player_card_data.json", cardData);
  }

  console.log("Updated player_card_data.json:", rows.length);
}

console.log("PITCH TYPE DESTRUCTION ENGINE COMPLETE");
