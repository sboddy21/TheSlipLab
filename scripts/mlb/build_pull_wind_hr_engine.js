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

function teamOf(row) {
  return key(row.team);
}

function gameKey(row) {
  return key(row.game || `${row.team} ${row.opponent}`);
}

function weatherFor(row, weatherData) {
  const rows = arr(weatherData);
  return rows.find(w => key(w.game) === gameKey(row)) ||
    rows.find(w => key(w.homeTeam) === teamOf(row) || key(w.awayTeam) === teamOf(row)) ||
    rows.find(w => key(w.team) === teamOf(row)) ||
    {};
}

function pullDirection(row) {
  const bat = String(row.batSide || row.bats || row.batSideDescription || "").toUpperCase();
  if (bat.startsWith("L")) return "RF";
  if (bat.startsWith("R")) return "LF";
  return "CF";
}

function windBoost(row, weather) {
  const pull = pullDirection(row);
  const text = [
    weather.windDirection,
    weather.windCompass,
    weather.windDescription,
    weather.wind,
    row.weatherNote
  ].filter(Boolean).join(" ").toUpperCase();

  const speed = num(weather.windSpeed ?? weather.wind_mph ?? weather.windMph);

  let directionScore = 0;

  if (text.includes("OUT")) directionScore += 35;
  if (pull === "RF" && (text.includes("RF") || text.includes("RIGHT"))) directionScore += 35;
  if (pull === "LF" && (text.includes("LF") || text.includes("LEFT"))) directionScore += 35;
  if (pull === "CF" && (text.includes("CF") || text.includes("CENTER"))) directionScore += 25;

  if (text.includes("IN")) directionScore -= 30;

  return clamp(directionScore + Math.min(30, speed * 2.2));
}

function parkBoost(row) {
  return clamp(
    num(row.parkFactor ?? row.parkBoost ?? row.hrParkFactor) * 18 +
    num(row.weather) * 0.45
  );
}

function pullPower(row) {
  const hr = num(row.stats?.hitter?.hr ?? row.hitterStats?.hr ?? row.hr ?? row.homeRuns);
  const slg = num(row.stats?.hitter?.slg ?? row.hitterStats?.slg ?? row.slg);
  const avg = num(row.stats?.hitter?.avg ?? row.hitterStats?.avg ?? row.avg);
  const iso = num(row.iso ?? Math.max(0, slg - avg));
  const archetype = num(row.hrArchetypeScore);

  return clamp(
    archetype * 0.40 +
    Math.min(100, hr * 4.5) * 0.25 +
    Math.min(100, iso * 320) * 0.25 +
    Math.min(100, slg * 115) * 0.10
  );
}

function pullWindScore(row, weatherData) {
  const weather = weatherFor(row, weatherData);
  const wind = windBoost(row, weather);
  const park = parkBoost(row);
  const power = pullPower(row);

  return clamp(
    wind * 0.38 +
    park * 0.22 +
    power * 0.40
  );
}

function tag(score) {
  if (score >= 75) return "Pull Wind Nuke";
  if (score >= 60) return "Pull Carry Boost";
  if (score >= 45) return "Carry Edge";
  if (score >= 30) return "Small Carry";
  return "Neutral";
}

function enrich(row, weatherData) {
  const score = pullWindScore(row, weatherData);
  const bonus =
    score >= 75 ? 7 :
    score >= 60 ? 5 :
    score >= 45 ? 3 :
    score >= 30 ? 1.5 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const next = clamp(base + bonus);

  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];
  if (bonus > 0) reasons.push(`${tag(score)} to ${pullDirection(row)}`);

  return {
    ...row,
    score: Math.round(next * 10) / 10,
    hrConfidence: Math.round(next * 10) / 10,
    pullSideField: pullDirection(row),
    pullWindHrScore: Math.round(score * 10) / 10,
    pullWindHrTag: tag(score),
    pullWindHrBonus: bonus,
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

const weather = read("mlb_weather.json", {});
const homeRuns = read("mlb_home_runs.json", []);

if (Array.isArray(homeRuns)) {
  const rows = homeRuns
    .map(row => enrich(row, weather))
    .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  write("mlb_home_runs.json", rows);
  console.log("Updated mlb_home_runs.json:", rows.length);
}

const dc = read("hr_decision_center.json", null);

if (dc?.allPlayers) {
  const rows = dc.allPlayers
    .map(row => enrich(row, weather))
    .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence));

  write("hr_decision_center.json", {
    ...dc,
    updatedAt: new Date().toISOString(),
    pullWindHrUpdatedAt: new Date().toISOString(),
    sections: rebuildSections(rows),
    allPlayers: rows
  });

  console.log("Updated hr_decision_center.json:", rows.length);
}

const cardData = read("player_card_data.json", null);

if (cardData) {
  const rows = arr(cardData).map(row => enrich(row, weather));

  if (Array.isArray(cardData)) write("player_card_data.json", rows);
  else if (cardData.players) write("player_card_data.json", { ...cardData, players: rows });

  console.log("Updated player_card_data.json:", rows.length);
}

console.log("PULL WIND HR ENGINE COMPLETE");
