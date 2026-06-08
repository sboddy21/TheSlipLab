const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "../../website/data");

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
}

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function fail(msg) {
  console.error("MLB VALIDATION FAILED:", msg);
  process.exit(1);
}

const today = todayET();

const games = read("mlb_games_today.json");
if (games.date !== today) fail(`mlb_games_today date is ${games.date}, expected ${today}`);

const pool = read("mlb_player_pool.json");
if (pool.date !== today) fail(`mlb_player_pool date is ${pool.date}, expected ${today}`);
if (!Array.isArray(pool.players) || pool.players.length < 50) fail("player pool is too small");

const matchups = read("game_pitcher_matchups.json");
if (!Array.isArray(matchups.games) || matchups.games.length !== games.games.length) {
  fail("matchup game count does not match mlb_games_today");
}

for (const g of matchups.games) {
  const away = g.hitters?.away?.length || 0;
  const home = g.hitters?.home?.length || 0;
  if (away === 0 || home === 0) fail(`${g.matchup} has empty hitters`);
}

const hr = read("mlb_home_runs.json");
if (!Array.isArray(hr) || hr.length < 40) fail("HR board is too small");

console.log("MLB validation passed:", today);
