import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_context_factors.json");

const todayET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

const SCHEDULE_URL = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${todayET}&hydrate=venue,weather,officials`;
const LIVE_FEED_BASE = "https://statsapi.mlb.com/api/v1.1/game";

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return res.json();
}

function safe(v, fallback = "") {
  return v === undefined || v === null || v === "" ? fallback : v;
}

function findHomePlateUmpire(feed) {
  const officials = feed?.liveData?.boxscore?.officials || feed?.gameData?.officials || [];

  const hp = officials.find(o => {
    const type = String(o?.officialType || o?.officialType?.name || "").toLowerCase();
    return type.includes("home") || type.includes("plate");
  });

  return {
    name: safe(hp?.official?.fullName),
    id: safe(hp?.official?.id),
    role: safe(hp?.officialType || "Home Plate")
  };
}

function venueInfo(feed, game) {
  const venue = feed?.gameData?.venue || game?.venue || {};
  return {
    id: safe(venue.id),
    name: safe(venue.name),
    link: safe(venue.link)
  };
}

function gameTeams(feed, game) {
  const away = feed?.gameData?.teams?.away?.name || game?.teams?.away?.team?.name;
  const home = feed?.gameData?.teams?.home?.name || game?.teams?.home?.team?.name;

  return {
    away: safe(away),
    home: safe(home),
    matchup: away && home ? `${away} @ ${home}` : ""
  };
}

function weatherInfo(feed) {
  const weather = feed?.gameData?.weather || {};
  return {
    condition: safe(weather.condition),
    temp: safe(weather.temp),
    wind: safe(weather.wind)
  };
}

function roofInfo(feed) {
  const gameInfo = feed?.gameData?.gameInfo || {};
  return {
    roof: safe(gameInfo.roof),
    surface: safe(gameInfo.fieldInfo?.turfType || gameInfo.surface)
  };
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  const schedule = await getJSON(SCHEDULE_URL);
  const games = schedule?.dates?.flatMap(d => d.games || []) || [];

  const contexts = [];

  for (const game of games) {
    const gamePk = game?.gamePk;
    if (!gamePk) continue;

    let feed = null;

    try {
      feed = await getJSON(`${LIVE_FEED_BASE}/${gamePk}/feed/live`);
    } catch {
      feed = null;
    }

    const source = feed || { gameData: {}, liveData: {} };

    contexts.push({
      gamePk,
      date: todayET,
      status: safe(game?.status?.detailedState),
      teams: gameTeams(source, game),
      venue: venueInfo(source, game),
      weather: weatherInfo(source),
      roof: roofInfo(source),
      umpire: findHomePlateUmpire(source),
      dataQuality: {
        umpireAvailable: Boolean(findHomePlateUmpire(source).name),
        weatherAvailable: Boolean(weatherInfo(source).condition || weatherInfo(source).temp || weatherInfo(source).wind),
        venueAvailable: Boolean(venueInfo(source, game).name)
      },
      sources: {
        schedule: "MLB Stats API schedule hydrate venue/weather/officials",
        liveFeed: "MLB Stats API live feed",
        parkFactors: "Use Baseball Savant Statcast park factors as external reference layer"
      }
    });
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    updatedAt: new Date().toISOString(),
    date: todayET,
    count: contexts.length,
    contexts
  }, null, 2));

  console.log("CONTEXT FACTORS COMPLETE");
  console.log("Date:", todayET);
  console.log("Games:", contexts.length);
  console.log("Saved:", OUT_FILE);
}

main().catch(err => {
  console.error("CONTEXT FACTORS FAILED");
  console.error(err);
  process.exit(1);
});
