import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUTFILE = path.join(ROOT, "website", "data", "mlb_results.json");

function datePartsInNY(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);

  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));

  return {
    year: obj.year,
    month: obj.month,
    day: obj.day,
    hour: Number(obj.hour)
  };
}

function ymdFromParts(p) {
  return `${p.year}-${p.month}-${p.day}`;
}

function addDaysNY(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return ymdFromParts(datePartsInNY(utc));
}

function targetDate() {
  const arg = process.argv[2];

  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    return {
      date: arg,
      mode: "manual"
    };
  }

  const now = datePartsInNY();
  const today = ymdFromParts(now);

  if (now.hour < 10) {
    return {
      date: addDaysNY(today, -1),
      mode: "yesterday_until_10am_et"
    };
  }

  return {
    date: today,
    mode: "live_today_after_10am_et"
  };
}

const TARGET = targetDate();

async function getJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Request failed ${res.status}: ${url}`);
  }

  return await res.json();
}

function safe(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function teamName(team) {
  return safe(team?.team?.name || team?.name || team?.teamName);
}

function isHomeRun(play) {
  const event = safe(play?.result?.event).toLowerCase();
  const eventType = safe(play?.result?.eventType).toLowerCase();
  const description = safe(play?.result?.description).toLowerCase();

  return (
    event === "home run" ||
    eventType === "home_run" ||
    description.includes(" homers") ||
    description.includes("home run")
  );
}

function parseHr(play, feed) {
  const batter = play?.matchup?.batter || {};
  const pitcher = play?.matchup?.pitcher || {};
  const away = teamName(feed?.gameData?.teams?.away);
  const home = teamName(feed?.gameData?.teams?.home);
  const isTop = safe(play?.about?.halfInning).toLowerCase() === "top";

  return {
    player: safe(batter.fullName, "Unknown Player"),
    playerId: batter.id || null,
    team: isTop ? away : home,
    opponent: isTop ? home : away,
    game: `${away} at ${home}`,
    pitcher: safe(pitcher.fullName),
    pitcherId: pitcher.id || null,
    inning: play?.about?.inning || "",
    half: safe(play?.about?.halfInning),
    result: "HR",
    event: "Home Run",
    description: safe(play?.result?.description),
    did_homer: true
  };
}

async function main() {
  fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });

  const schedule = await getJson(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${TARGET.date}&hydrate=team,linescore`
  );

  const games = schedule?.dates?.[0]?.games || [];
  const homeRuns = [];

  for (const game of games) {
    try {
      const feed = await getJson(
        `https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`
      );

      const plays = feed?.liveData?.plays?.allPlays || [];

      for (const play of plays) {
        if (isHomeRun(play)) {
          homeRuns.push(parseHr(play, feed));
        }
      }
    } catch (err) {
      console.log("Skipped game:", game.gamePk, err.message);
    }
  }

  const output = {
    updatedAt: new Date().toISOString(),
    date: TARGET.date,
    mode: TARGET.mode,
    cutoff: "10:00 AM ET",
    source: "MLB Stats API live feed",
    games: games.length,
    count: homeRuns.length,
    homeRuns,
    results: homeRuns
  };

  fs.writeFileSync(OUTFILE, JSON.stringify(output, null, 2));

  console.log("HR RESULTS COMPLETE");
  console.log("Mode:", TARGET.mode);
  console.log("Date:", TARGET.date);
  console.log("Games:", games.length);
  console.log("Home Runs:", homeRuns.length);
  console.log("Saved:", OUTFILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
