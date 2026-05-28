import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_results.json");

const todayET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

const SCHEDULE_URL = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${todayET}`;
const LIVE_FEED_BASE = "https://statsapi.mlb.com/api/v1.1/game";

const VALID_STATUSES = new Set([
  "In Progress",
  "Live",
  "Final",
  "Game Over",
  "Completed Early"
]);

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return res.json();
}

function safe(v, fallback = "") {
  return v === undefined || v === null ? fallback : v;
}

function isHomeRun(play) {
  const event = String(play?.result?.event || "").toLowerCase();
  const eventType = String(play?.result?.eventType || "").toLowerCase();

  return (
    event === "home run" ||
    eventType === "home_run" ||
    event.includes("home run")
  );
}

function getRbi(play) {
  return Number(play?.result?.rbi || 0);
}

function getInning(play) {
  const about = play?.about || {};
  const half = about.halfInning ? String(about.halfInning) : "";
  const inning = about.inning ? String(about.inning) : "";

  if (!inning) return "";
  if (!half) return inning;

  return `${half[0].toUpperCase()}${half.slice(1)} ${inning}`;
}

function getPitcher(play) {
  const matchup = play?.matchup || {};
  return safe(matchup?.pitcher?.fullName);
}

function getBatter(play) {
  const matchup = play?.matchup || {};
  return safe(matchup?.batter?.fullName);
}

function getTeam(play, liveData) {
  const battingSide = play?.about?.isTopInning ? "away" : "home";
  return safe(liveData?.boxscore?.teams?.[battingSide]?.team?.name);
}

function getOpponent(play, liveData) {
  const oppSide = play?.about?.isTopInning ? "home" : "away";
  return safe(liveData?.boxscore?.teams?.[oppSide]?.team?.name);
}

function getGameLabel(gameData) {
  const away = safe(gameData?.teams?.away?.team?.name);
  const home = safe(gameData?.teams?.home?.team?.name);
  return away && home ? `${away} @ ${home}` : "";
}

function getScore(liveData) {
  const away = liveData?.linescore?.teams?.away?.runs;
  const home = liveData?.linescore?.teams?.home?.runs;

  if (away === undefined || home === undefined) return "";
  return `${away}-${home}`;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  const schedule = await getJSON(SCHEDULE_URL);
  const games = schedule?.dates?.flatMap(d => d.games || []) || [];

  const homeRuns = [];
  let checkedGames = 0;

  for (const game of games) {
    const status = safe(game?.status?.detailedState);
    const gamePk = game?.gamePk;

    if (!gamePk) continue;
    if (!VALID_STATUSES.has(status)) continue;

    checkedGames += 1;

    const feed = await getJSON(`${LIVE_FEED_BASE}/${gamePk}/feed/live`);
    const plays = feed?.liveData?.plays?.allPlays || [];
    const gameLabel = getGameLabel(feed?.gameData || game);
    const score = getScore(feed?.liveData || {});

    for (const play of plays) {
      if (!isHomeRun(play)) continue;

      const batter = getBatter(play);
      const pitcher = getPitcher(play);
      const team = getTeam(play, feed?.liveData || {});
      const opponent = getOpponent(play, feed?.liveData || {});

      homeRuns.push({
        gamePk,
        game: gameLabel,
        status,
        inning: getInning(play),
        batter,
        player: batter,
        team,
        opponent,
        pitcher,
        rbi: getRbi(play),
        description: safe(play?.result?.description),
        event: safe(play?.result?.event),
        eventType: safe(play?.result?.eventType),
        score,
        playId: safe(play?.about?.atBatIndex),
        startTime: safe(play?.about?.startTime),
        endTime: safe(play?.about?.endTime)
      });
    }
  }

  homeRuns.sort((a, b) => {
    const at = a.endTime || a.startTime || "";
    const bt = b.endTime || b.startTime || "";
    return String(bt).localeCompare(String(at));
  });

  const out = {
    updatedAt: new Date().toISOString(),
    date: todayET,
    mode: "live_and_final_games",
    source: "MLB Stats API schedule plus live feed",
    totalScheduledGames: games.length,
    checkedGames,
    count: homeRuns.length,
    homeRuns
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  console.log("HR RESULTS COMPLETE");
  console.log("Mode: live_and_final_games");
  console.log("Date:", todayET);
  console.log("Scheduled Games:", games.length);
  console.log("Checked Games:", checkedGames);
  console.log("Home Runs:", homeRuns.length);
  console.log("Saved:", OUT_FILE);
}

main().catch(err => {
  console.error("HR RESULTS FAILED");
  console.error(err);
  process.exit(1);
});
