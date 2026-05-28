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
  return v === undefined || v === null || v === "" ? fallback : v;
}

function num(v) {
  if (v === undefined || v === null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return Math.round(n * 10) / 10;
}

function isHomeRun(play) {
  const event = String(play?.result?.event || "").toLowerCase();
  const eventType = String(play?.result?.eventType || "").toLowerCase();
  return event === "home run" || eventType === "home_run" || event.includes("home run");
}

function uniquePlays(feed) {
  const allPlays = feed?.liveData?.plays?.allPlays || [];
  const scoringIndexes = feed?.liveData?.plays?.scoringPlays || [];

  const plays = [...allPlays];
  const seen = new Set(allPlays.map(p => String(p?.about?.atBatIndex ?? "")));

  for (const idx of scoringIndexes) {
    const p = allPlays[idx];
    const key = String(p?.about?.atBatIndex ?? idx);
    if (p && !seen.has(key)) {
      plays.push(p);
      seen.add(key);
    }
  }

  return plays;
}

function getInning(play) {
  const half = safe(play?.about?.halfInning);
  const inning = safe(play?.about?.inning);
  if (!inning) return "";
  return `${half ? half[0].toUpperCase() + half.slice(1) : ""} ${inning}`.trim();
}

function getLastPitch(play) {
  const events = Array.isArray(play?.playEvents) ? play.playEvents : [];
  return [...events].reverse().find(e => e?.isPitch || e?.type === "pitch") || {};
}

function getCount(play, pitch) {
  const balls = pitch?.count?.balls ?? play?.count?.balls;
  const strikes = pitch?.count?.strikes ?? play?.count?.strikes;
  if (balls === undefined || strikes === undefined) return "";
  return `${balls}-${strikes}`;
}

function getGameLabel(feed, game) {
  const away = safe(feed?.gameData?.teams?.away?.name || game?.teams?.away?.team?.name);
  const home = safe(feed?.gameData?.teams?.home?.name || game?.teams?.home?.team?.name);
  return away && home ? `${away} @ ${home}` : "";
}

function getScore(feed) {
  const away = feed?.liveData?.linescore?.teams?.away?.runs;
  const home = feed?.liveData?.linescore?.teams?.home?.runs;
  if (away === undefined || home === undefined) return "";
  return `${away}-${home}`;
}

function getTeam(play, feed) {
  const side = play?.about?.isTopInning ? "away" : "home";
  return safe(feed?.liveData?.boxscore?.teams?.[side]?.team?.name);
}

function getOpponent(play, feed) {
  const side = play?.about?.isTopInning ? "home" : "away";
  return safe(feed?.liveData?.boxscore?.teams?.[side]?.team?.name);
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  const schedule = await getJSON(SCHEDULE_URL);
  const games = schedule?.dates?.flatMap(d => d.games || []) || [];

  const homeRuns = [];
  let checkedGames = 0;

  for (const game of games) {
    const gamePk = game?.gamePk;
    const status = safe(game?.status?.detailedState);

    if (!gamePk || !VALID_STATUSES.has(status)) continue;

    checkedGames += 1;

    const feed = await getJSON(`${LIVE_FEED_BASE}/${gamePk}/feed/live`);
    const plays = uniquePlays(feed);
    const gameLabel = getGameLabel(feed, game);
    const score = getScore(feed);

    for (const play of plays) {
      if (!isHomeRun(play)) continue;

      const pitch = getLastPitch(play);
      const hitData = pitch?.hitData || {};
      const pitchData = pitch?.pitchData || {};
      const details = pitch?.details || {};

      const batter = safe(play?.matchup?.batter?.fullName);
      const pitcher = safe(play?.matchup?.pitcher?.fullName);

      homeRuns.push({
        gamePk,
        game: gameLabel,
        status,
        inning: getInning(play),
        batter,
        player: batter,
        team: getTeam(play, feed),
        opponent: getOpponent(play, feed),
        pitcher,
        rbi: Number(play?.result?.rbi || 0),
        description: safe(play?.result?.description),
        event: safe(play?.result?.event),
        eventType: safe(play?.result?.eventType),
        score,
        playId: safe(play?.about?.atBatIndex),
        startTime: safe(play?.about?.startTime),
        endTime: safe(play?.about?.endTime),

        exitVelocity: num(hitData?.launchSpeed),
        launchAngle: num(hitData?.launchAngle),
        distance: num(hitData?.totalDistance),
        trajectory: safe(hitData?.trajectory),
        hardness: safe(hitData?.hardness),
        pitchType: safe(details?.type?.description || details?.type?.code),
        pitchCode: safe(details?.type?.code),
        pitchVelocity: num(pitchData?.startSpeed),
        plateX: num(pitchData?.coordinates?.pX),
        plateZ: num(pitchData?.coordinates?.pZ),
        strikeZoneTop: num(pitchData?.strikeZoneTop),
        strikeZoneBottom: num(pitchData?.strikeZoneBottom),
        count: getCount(play, pitch)
      });
    }
  }

  homeRuns.sort((a, b) => String(b.endTime || b.startTime || "").localeCompare(String(a.endTime || a.startTime || "")));

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    updatedAt: new Date().toISOString(),
    date: todayET,
    mode: "live_and_final_games",
    source: "MLB Stats API live feed",
    totalScheduledGames: games.length,
    checkedGames,
    count: homeRuns.length,
    homeRuns
  }, null, 2));

  console.log("HR RESULTS COMPLETE");
  console.log("Mode: live_and_final_games");
  console.log("Date:", todayET);
  console.log("Games:", checkedGames);
  console.log("Home Runs:", homeRuns.length);
  console.log("Saved:", OUT_FILE);
}

main().catch(err => {
  console.error("HR RESULTS FAILED");
  console.error(err);
  process.exit(1);
});
