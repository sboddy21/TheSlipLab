import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const OUT_FILE = path.join(DATA_DIR, "mlb_results.json");
const CONTEXT_FILE = path.join(DATA_DIR, "mlb_context_factors.json");

function etDate(offsetDays = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

const argDate = process.argv.find(a => a.startsWith("--date="))?.split("=")[1];
const argOut = process.argv.find(a => a.startsWith("--out="))?.split("=")[1];

const targetDate = argDate || etDate(0);
const outputFile = argOut ? path.join(ROOT, argOut) : OUT_FILE;

const SCHEDULE_URL = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${targetDate}&hydrate=venue,weather,officials`;
const LIVE_FEED_BASE = "https://statsapi.mlb.com/api/v1.1/game";

const VALID_STATUSES = new Set([
  "In Progress",
  "Live",
  "Final",
  "Game Over",
  "Completed Early"
]);

const FINAL_STATUSES = new Set([
  "Final",
  "Game Over",
  "Completed Early"
]);

const TERMINAL_NON_PLAYED_STATUSES = new Set([
  "Postponed",
  "Cancelled",
  "Canceled",
  "No Game"
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

function isBarrelContact(exitVelocity, launchAngle) {
  const ev = Number(exitVelocity);
  const la = Number(launchAngle);
  if (!Number.isFinite(ev) || !Number.isFinite(la) || ev < 98) return false;

  const over98 = Math.min(ev - 98, 18);
  const minLaunchAngle = 26 - over98;
  const maxLaunchAngle = 30 + over98 * (20 / 18);
  return la >= minLaunchAngle && la <= maxLaunchAngle;
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function buildContextMap(date) {
  const ctx = readJSON(CONTEXT_FILE, {});
  if (ctx?.date !== date) return new Map();
  const contexts = Array.isArray(ctx?.contexts) ? ctx.contexts : [];
  return new Map(contexts.map(c => [String(c.gamePk), c]));
}

function getOfficialName(game, feed) {
  const scheduleOfficials = Array.isArray(game?.officials) ? game.officials : [];
  const liveOfficials = Array.isArray(feed?.liveData?.boxscore?.officials) ? feed.liveData.boxscore.officials : [];
  const all = [...scheduleOfficials, ...liveOfficials];

  const hp = all.find(o =>
    String(o?.officialType || o?.officialTypeCode || o?.role || "").toLowerCase().includes("home")
  );

  return safe(hp?.official?.fullName || hp?.official?.name || hp?.name);
}

function getGameContext(game, feed, contextMap) {
  const gamePk = String(game?.gamePk || "");
  const ctx = contextMap.get(gamePk) || {};

  const venueName = safe(feed?.gameData?.venue?.name || game?.venue?.name || ctx?.venue?.name);
  const weatherCondition = safe(feed?.gameData?.weather?.condition || game?.weather?.condition || ctx?.weather?.condition);
  const weatherTemp = safe(feed?.gameData?.weather?.temp || game?.weather?.temp || ctx?.weather?.temp);
  const weatherWind = safe(feed?.gameData?.weather?.wind || game?.weather?.wind || ctx?.weather?.wind);
  const roofStatus = safe(feed?.gameData?.venue?.roofType || feed?.gameData?.venue?.roof || game?.venue?.roofType || ctx?.roof?.roof);
  const umpireName = safe(getOfficialName(game, feed) || ctx?.umpire?.name);

  let contextScoreValue = 0;
  if (venueName) contextScoreValue += 20;
  if (weatherCondition || weatherTemp || weatherWind) contextScoreValue += 30;
  if (umpireName) contextScoreValue += 25;
  if (roofStatus) contextScoreValue += 10;

  return {
    venueName,
    umpireName,
    roofStatus,
    weatherCondition,
    weatherTemp,
    weatherWind,
    contextScoreValue
  };
}

function isHomeRun(play) {
  const event = String(play?.result?.event || "").toLowerCase();
  const eventType = String(play?.result?.eventType || "").toLowerCase();
  return event === "home run" || eventType === "home_run" || event.includes("home run");
}

function airborneCategory(play) {
  const event = String(play?.result?.event || "").trim().toLowerCase();
  const eventType = String(play?.result?.eventType || "").trim().toLowerCase();

  if (isHomeRun(play)) return "home_run";
  if (event === "sac fly" || eventType === "sac_fly") return "sac_fly";
  if (event.includes("flyout") || event.includes("fly out")) return "flyout";
  if (event.includes("lineout") || event.includes("line out")) return "lineout";
  if (event.includes("pop out") || event.includes("popout")) return "pop_out";
  return "";
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

function buildEventRow({ date, game, feed, play, status, gameLabel, score, gameContext }) {
  const pitch = getLastPitch(play);
  const hitData = pitch?.hitData || {};
  const pitchData = pitch?.pitchData || {};
  const details = pitch?.details || {};
  const batter = safe(play?.matchup?.batter?.fullName);
  const category = airborneCategory(play);
  const distance = num(hitData?.totalDistance);
  const exitVelocity = num(hitData?.launchSpeed);
  const launchAngle = num(hitData?.launchAngle);

  return {
    date,
    gamePk: game?.gamePk,
    game: gameLabel,
    gameStartTime: safe(game?.gameDate || feed?.gameData?.datetime?.dateTime),
    status,
    inning: getInning(play),
    playerId: safe(play?.matchup?.batter?.id),
    batter,
    player: batter,
    team: getTeam(play, feed),
    opponent: getOpponent(play, feed),
    pitcherId: safe(play?.matchup?.pitcher?.id),
    pitcher: safe(play?.matchup?.pitcher?.fullName),
    rbi: Number(play?.result?.rbi || 0),
    description: safe(play?.result?.description),
    event: safe(play?.result?.event),
    eventType: safe(play?.result?.eventType),
    category,
    isCloseCall: category !== "home_run" && distance !== "" && Number(distance) >= 350,
    score,
    playId: safe(play?.about?.atBatIndex),
    startTime: safe(play?.about?.startTime),
    endTime: safe(play?.about?.endTime),
    exitVelocity,
    launchAngle,
    isBarrel: isBarrelContact(exitVelocity, launchAngle),
    distance,
    trajectory: safe(hitData?.trajectory),
    hardness: safe(hitData?.hardness),
    pitchType: safe(details?.type?.description || details?.type?.code),
    pitchCode: safe(details?.type?.code),
    pitchVelocity: num(pitchData?.startSpeed),
    plateX: num(pitchData?.coordinates?.pX),
    plateZ: num(pitchData?.coordinates?.pZ),
    strikeZoneTop: num(pitchData?.strikeZoneTop),
    strikeZoneBottom: num(pitchData?.strikeZoneBottom),
    count: getCount(play, pitch),
    ...gameContext
  };
}

async function buildResults(date) {
  const schedule = await getJSON(SCHEDULE_URL);
  const games = schedule?.dates?.flatMap(d => d.games || []) || [];

  const contextMap = buildContextMap(date);

  const homeRuns = [];
  const playerEvents = [];
  let checkedGames = 0;
  let skippedGames = 0;
  let finalGames = 0;
  let liveGames = 0;
  const terminalNonPlayed = [];
  const rescheduledGames = [];

  for (const game of games) {
    const gamePk = game?.gamePk;
    const status = safe(game?.status?.detailedState);
    const rescheduledFrom = safe(game?.rescheduledFrom);

    if (gamePk && rescheduledFrom && !rescheduledFrom.startsWith(date)) {
      rescheduledGames.push({
        gamePk,
        game: getGameLabel({}, game),
        rescheduledFrom
      });
    }

    if (gamePk && TERMINAL_NON_PLAYED_STATUSES.has(status)) {
      terminalNonPlayed.push({
        gamePk,
        status,
        game: getGameLabel({}, game),
        rescheduleDate: safe(game?.rescheduleDate)
      });
      continue;
    }

    if (!gamePk || !VALID_STATUSES.has(status)) {
      skippedGames += 1;
      continue;
    }

    checkedGames += 1;
    if (FINAL_STATUSES.has(status)) finalGames += 1;
    else liveGames += 1;

    const feed = await getJSON(`${LIVE_FEED_BASE}/${gamePk}/feed/live`);
    const plays = uniquePlays(feed);
    const gameLabel = getGameLabel(feed, game);
    const score = getScore(feed);
    const gameContext = getGameContext(game, feed, contextMap);

    for (const play of plays) {
      const category = airborneCategory(play);
      if (!category) continue;

      const row = buildEventRow({ date, game, feed, play, status, gameLabel, score, gameContext });
      playerEvents.push(row);
      if (category === "home_run") homeRuns.push(row);
    }
  }

  homeRuns.sort((a, b) =>
    String(b.endTime || b.startTime || "").localeCompare(String(a.endTime || a.startTime || ""))
  );
  playerEvents.sort((a, b) =>
    String(b.endTime || b.startTime || "").localeCompare(String(a.endTime || a.startTime || ""))
  );

  return {
    updatedAt: new Date().toISOString(),
    date,
    mode: "live_and_final_games",
    source: "MLB Stats API live feed",
    totalScheduledGames: games.length,
    checkedGames,
    skippedGames,
    finalGames,
    liveGames,
    terminalNonPlayedGames: terminalNonPlayed.length,
    terminalNonPlayed,
    rescheduledGameCount: rescheduledGames.length,
    rescheduledGames,
    count: homeRuns.length,
    homeRuns,
    playerEventCount: playerEvents.length,
    playerEvents
  };
}

async function main() {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const results = await buildResults(targetDate);
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  console.log("HR RESULTS COMPLETE");
  console.log("Date:", targetDate);
  console.log("Games checked:", results.checkedGames);
  console.log("Games skipped:", results.skippedGames);
  console.log("Games terminal without play:", results.terminalNonPlayedGames);
  console.log("Home Runs:", results.homeRuns.length);
  console.log("Tracked Airborne Events:", results.playerEvents.length);
  console.log("Saved:", outputFile);
}

main().catch(err => {
  console.error("HR RESULTS FAILED");
  console.error(err);
  process.exit(1);
});
