import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const HR_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const WEATHER_FILE = path.join(ROOT, "website", "data", "mlb_weather.json");
const PARK_FILE = path.join(ROOT, "website", "data", "mlb_park_factors.json");
const OUT_FILE = path.join(ROOT, "website", "data", "park_carry_visuals.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function n(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function norm(value) {
  return String(value || "").toLowerCase().trim();
}

function getRows(payload, keys) {
  if (Array.isArray(payload)) return payload;

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  return [];
}

function findByVenue(rows, venue) {
  const target = norm(venue);
  return rows.find(row => norm(row.venue || row.ballpark || row.stadium) === target) || null;
}

function windCarryBoost(weather) {
  const speed = n(weather?.windSpeed ?? weather?.wind_speed);
  const text = norm(weather?.windText || weather?.wind_text || weather?.windCompass || weather?.wind || "");

  if (!speed) return 0;

  if (
    text.includes("out") ||
    text.includes("cf") ||
    text.includes("lf") ||
    text.includes("rf")
  ) {
    return clamp(speed * 1.7, 0, 24);
  }

  if (text.includes("in")) {
    return clamp(speed * -1.5, -22, 0);
  }

  return clamp(speed * 0.45, 0, 8);
}

function roofRead(park, weather) {
  const roof = norm(park?.roof || weather?.roof || weather?.roof_flag);

  if (roof.includes("dome") || roof.includes("closed") || roof === "1") {
    return {
      label: "Roof Controlled",
      boost: 0,
      activeWind: false
    };
  }

  return {
    label: "Open Air",
    boost: 4,
    activeWind: true
  };
}

function buildCarry(row, weather, park) {
  const temp = n(weather?.temp ?? weather?.temperature, 70);
  const humidity = n(weather?.humidity, 50);
  const hrFactor = n(park?.hrFactor ?? park?.hr_factor, 100);
  const roof = roofRead(park, weather);
  const windBoost = roof.activeWind ? windCarryBoost(weather) : 0;

  const tempBoost = clamp((temp - 68) * 0.65, -12, 18);
  const humidityBoost = clamp((humidity - 45) * 0.14, -5, 7);
  const parkBoost = clamp((hrFactor - 100) * 0.8, -20, 24);

  const carryScore = Math.round(clamp(50 + tempBoost + humidityBoost + parkBoost + windBoost + roof.boost, 1, 99));

  let label = "Neutral Carry";
  if (carryScore >= 78) label = "Elite Carry";
  else if (carryScore >= 64) label = "Positive Carry";
  else if (carryScore <= 38) label = "Suppressed Carry";

  return {
    venue: row.venue || null,
    label,
    carryScore,
    temp,
    humidity,
    wind: weather?.windText || weather?.wind_text || weather?.windCompass || weather?.wind || "N/A",
    windSpeed: n(weather?.windSpeed ?? weather?.wind_speed),
    roof: roof.label,
    parkFactor: hrFactor,
    tempBoost: Math.round(tempBoost),
    humidityBoost: Math.round(humidityBoost),
    windBoost: Math.round(windBoost),
    parkBoost: Math.round(parkBoost),
    activeWind: roof.activeWind
  };
}

function main() {
  const board = readJson(HR_FILE, []);
  const weatherPayload = readJson(WEATHER_FILE, {});
  const parkPayload = readJson(PARK_FILE, {});

  const rows = Array.isArray(board) ? board : [];
  const weatherRows = getRows(weatherPayload, ["weather", "rows", "venues"]);
  const parkRows = getRows(parkPayload, ["parks", "rows", "venues"]);

  const output = {
    updated_at: new Date().toISOString(),
    source: "slip_lab_park_carry_model",
    players: {}
  };

  for (const row of rows) {
    if (!row.player) continue;

    const weather = findByVenue(weatherRows, row.venue) || {};
    const park = findByVenue(parkRows, row.venue) || {};

    output.players[row.player] = {
      playerId: row.playerId || null,
      team: row.team || null,
      carry: buildCarry(row, weather, park)
    };
  }

  writeJson(OUT_FILE, output);

  console.log("PARK CARRY VISUALS COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
