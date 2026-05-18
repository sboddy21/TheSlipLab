import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "website", "data");
const GAMES_FILE = path.join(DATA_DIR, "mlb_games_today.json");
const OUT_FILE = path.join(DATA_DIR, "mlb_weather.json");

const PARKS = {
  "Angel Stadium": { city: "Anaheim", lat: 33.8003, lon: -117.8827 },
  "Busch Stadium": { city: "St. Louis", lat: 38.6226, lon: -90.1928 },
  "Chase Field": { city: "Phoenix", lat: 33.4455, lon: -112.0667 },
  "Citi Field": { city: "New York", lat: 40.7571, lon: -73.8458 },
  "Citizens Bank Park": { city: "Philadelphia", lat: 39.9061, lon: -75.1665 },
  "Comerica Park": { city: "Detroit", lat: 42.339, lon: -83.0485 },
  "Coors Field": { city: "Denver", lat: 39.7561, lon: -104.9942 },
  "Daikin Park": { city: "Houston", lat: 29.7573, lon: -95.3555 },
  "Dodger Stadium": { city: "Los Angeles", lat: 34.0739, lon: -118.24 },
  "Fenway Park": { city: "Boston", lat: 42.3467, lon: -71.0972 },
  "George M. Steinbrenner Field": { city: "Tampa", lat: 27.9803, lon: -82.5067 },
  "Globe Life Field": { city: "Arlington", lat: 32.7473, lon: -97.0842 },
  "Great American Ball Park": { city: "Cincinnati", lat: 39.0975, lon: -84.5066 },
  "Guaranteed Rate Field": { city: "Chicago", lat: 41.83, lon: -87.6338 },
  "Kauffman Stadium": { city: "Kansas City", lat: 39.0517, lon: -94.4803 },
  "loanDepot park": { city: "Miami", lat: 25.7781, lon: -80.2197 },
  "Nationals Park": { city: "Washington", lat: 38.873, lon: -77.0074 },
  "Oracle Park": { city: "San Francisco", lat: 37.7786, lon: -122.3893 },
  "Oriole Park at Camden Yards": { city: "Baltimore", lat: 39.284, lon: -76.6217 },
  "Petco Park": { city: "San Diego", lat: 32.7073, lon: -117.1566 },
  "PNC Park": { city: "Pittsburgh", lat: 40.4469, lon: -80.0057 },
  "Progressive Field": { city: "Cleveland", lat: 41.4962, lon: -81.6852 },
  "Rate Field": { city: "Chicago", lat: 41.83, lon: -87.6338 },
  "Rogers Centre": { city: "Toronto", lat: 43.6414, lon: -79.3894 },
  "T-Mobile Park": { city: "Seattle", lat: 47.5914, lon: -122.3325 },
  "Target Field": { city: "Minneapolis", lat: 44.9817, lon: -93.2776 },
  "Tropicana Field": { city: "St. Petersburg", lat: 27.7682, lon: -82.6534 },
  "Truist Park": { city: "Atlanta", lat: 33.8907, lon: -84.4677 },
  "Wrigley Field": { city: "Chicago", lat: 41.9484, lon: -87.6553 },
  "Yankee Stadium": { city: "New York", lat: 40.8296, lon: -73.9262 }
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function windCompass(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return "Unknown";

  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(n / 45) % 8];
}

async function fetchWeather(park) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${park.lat}&longitude=${park.lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Weather request failed ${res.status}`);
  }

  const data = await res.json();
  const current = data.current || {};

  const windDirection = round(current.wind_direction_10m, 0);
  const arrowDegrees = Number.isFinite(windDirection) ? (windDirection + 180) % 360 : 0;

  return {
    temp: round(current.temperature_2m, 0),
    humidity: round(current.relative_humidity_2m, 0),
    windSpeed: round(current.wind_speed_10m, 1),
    windDirection,
    windCompass: windCompass(windDirection),
    arrowDegrees,
    observedAt: current.time || null
  };
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const gamesData = readJson(GAMES_FILE, { games: [] });
  const games = Array.isArray(gamesData.games) ? gamesData.games : [];

  const venues = [...new Set(games.map(game => game.venue).filter(Boolean))];

  const rows = [];

  for (const venue of venues) {
    const park = PARKS[venue];

    if (!park) {
      rows.push({
        venue,
        city: null,
        temp: null,
        humidity: null,
        windSpeed: null,
        windDirection: null,
        windCompass: "Unknown",
        arrowDegrees: 0,
        status: "missing_park_coordinates",
        updatedAt: new Date().toISOString()
      });

      continue;
    }

    try {
      const weather = await fetchWeather(park);

      rows.push({
        venue,
        city: park.city,
        lat: park.lat,
        lon: park.lon,
        ...weather,
        status: "live",
        source: "Open Meteo",
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      rows.push({
        venue,
        city: park.city,
        lat: park.lat,
        lon: park.lon,
        temp: null,
        humidity: null,
        windSpeed: null,
        windDirection: null,
        windCompass: "Unknown",
        arrowDegrees: 0,
        status: "weather_error",
        error: error.message,
        updatedAt: new Date().toISOString()
      });
    }
  }

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        date: gamesData.date || new Date().toISOString().slice(0, 10),
        source: "Open Meteo",
        updatedAt: new Date().toISOString(),
        count: rows.length,
        weather: rows
      },
      null,
      2
    )
  );

  console.log("MLB WEATHER BOARD COMPLETE");
  console.log("Venues:", rows.length);
  console.log("Saved:", OUT_FILE);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
