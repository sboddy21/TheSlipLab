import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const HR_FILE = path.join(DATA_DIR, "mlb_home_runs.json");
const PARK_FILE = path.join(DATA_DIR, "mlb_park_factors.json");
const WEATHER_FILE = path.join(DATA_DIR, "mlb_weather.json");
const OUT_FILE = path.join(DATA_DIR, "mlb_team_stacks.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function clean(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).trim();
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function grade(score) {
  if (score >= 82) return "NUKE STACK";
  if (score >= 70) return "ATTACK STACK";
  if (score >= 58) return "LIVE STACK";
  return "WATCH STACK";
}

function getPark(parks, venue) {
  return parks.find(row =>
    clean(row.venue).toLowerCase() === clean(venue).toLowerCase()
  ) || null;
}

function getWeather(weather, venue) {
  return weather.find(row =>
    clean(row.venue).toLowerCase() === clean(venue).toLowerCase()
  ) || null;
}

function stackFactors(rows, park, weather) {
  const factors = [];
  const pitcher = rows[0]?.stats?.pitcher || {};
  const top = rows[0];

  const era = number(pitcher.era);
  const whip = number(pitcher.whip);
  const hrAllowed = number(pitcher.homeRuns);
  const hrFactor = number(park?.hrFactor, 100);
  const temp = number(weather?.temp);
  const wind = number(weather?.windSpeed);

  if (top) factors.push(`${top.opposingPitcher} is the target arm`);
  if (era >= 5) factors.push(`Pitcher ERA leak at ${era}`);
  if (whip >= 1.4) factors.push(`Traffic risk with ${whip} WHIP`);
  if (hrAllowed >= 5) factors.push(`${hrAllowed} HR allowed`);
  if (rows.length >= 3) factors.push(`${rows.length} bats from the same team made the board`);
  if (hrFactor >= 104) factors.push(`${park.venue} carries a ${hrFactor} HR factor`);
  if (temp >= 75) factors.push(`${temp} degree hitting environment`);
  if (wind >= 10) factors.push(`${wind} MPH wind is active`);

  if (!factors.length) factors.push("Stack is driven by clustered model scores");

  return factors.slice(0, 5);
}

function main() {
  const rows = readJson(HR_FILE, []);
  const parkData = readJson(PARK_FILE, { parks: [] });
  const weatherData = readJson(WEATHER_FILE, { weather: [] });

  const parks = parkData.parks || [];
  const weather = weatherData.weather || [];

  const map = new Map();

  rows.forEach(row => {
    const key = `${clean(row.game)}|${clean(row.team)}`;

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(row);
  });

  const stacks = [...map.entries()].map(([key, teamRows]) => {
    const sorted = teamRows.sort((a, b) => number(b.score) - number(a.score));
    const top = sorted[0];
    const pitcher = top?.stats?.pitcher || {};
    const hitters = sorted.map(row => row.stats?.hitter || {});
    const park = getPark(parks, top?.venue);
    const wx = getWeather(weather, top?.venue);

    const avgScore =
      sorted.reduce((sum, row) => sum + number(row.score), 0) / Math.max(sorted.length, 1);

    const powerScore =
      hitters.reduce((sum, hitter) => {
        return sum +
          Math.min(18, number(hitter.hr) * 1.2) +
          Math.min(14, number(hitter.slg) * 20) +
          Math.min(10, number(hitter.ops) * 8);
      }, 0) / Math.max(hitters.length, 1);

    const pitcherLeak =
      Math.min(22, number(pitcher.era) * 2.3) +
      Math.min(16, number(pitcher.whip) * 8) +
      Math.min(12, number(pitcher.homeRuns) * 1.2);

    const environment =
      (number(park?.hrFactor, 100) - 95) * 0.55 +
      Math.max(0, number(wx?.temp) - 65) * 0.25 +
      Math.min(6, number(wx?.windSpeed) * 0.35);

    const density = Math.min(12, sorted.length * 3.5);

    const stackScore = Math.round(
      Math.max(0, Math.min(100, avgScore * 0.45 + powerScore * 0.6 + pitcherLeak + environment + density))
    );

    return {
      team: clean(top?.team),
      opponent: clean(top?.opponent),
      game: clean(top?.game),
      venue: clean(top?.venue),
      opposingPitcher: clean(top?.opposingPitcher),
      bats: sorted.length,
      topScore: number(top?.score),
      stackScore,
      grade: grade(stackScore),
      parkFactor: park?.hrFactor || null,
      temp: wx?.temp || null,
      windSpeed: wx?.windSpeed || null,
      windCompass: wx?.windCompass || "",
      factors: stackFactors(sorted, park, wx),
      hitters: sorted.slice(0, 6).map(row => ({
        player: row.player,
        batSide: row.batSide,
        score: row.score,
        edge: row.edge,
        note: row.note,
        hr: row.stats?.hitter?.hr ?? null,
        slg: row.stats?.hitter?.slg ?? null,
        ops: row.stats?.hitter?.ops ?? null
      }))
    };
  })
  .filter(stack => stack.bats >= 2)
  .sort((a, b) => b.stackScore - a.stackScore);

  const output = {
    date: new Date().toISOString().slice(0, 10),
    source: "The Slip Lab HR board plus park and weather context",
    updatedAt: new Date().toISOString(),
    count: stacks.length,
    stacks
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  console.log("TEAM STACK ENGINE COMPLETE");
  console.log("Stacks:", stacks.length);
  console.log("Saved:", OUT_FILE);
}

main();
