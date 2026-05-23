import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUTFILE = path.join(ROOT, "website", "data", "mlb_results.json");

const today = new Date().toISOString().slice(0, 10);

function safe(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return await res.json();
}

function getTeamName(team) {
  return safe(team?.teamName || team?.name);
}

function isHomeRun(play) {
  const event = safe(play?.result?.event).toLowerCase();
  const eventType = safe(play?.result?.eventType).toLowerCase();
  const description = safe(play?.result?.description).toLowerCase();

  return (
    event === "home run" ||
    eventType === "home_run" ||
    description.includes("homers") ||
    description.includes("home run")
  );
}

function parseHomeRun(play, game) {
  const batter = play?.matchup?.batter || {};
  const pitcher = play?.matchup?.pitcher || {};
  const inning = play?.about?.inning || "";
  const half = play?.about?.halfInning || "";

  const away = getTeamName(game?.teams?.away);
  const home = getTeamName(game?.teams?.home);

  const battingSide = safe(play?.matchup?.batSide?.code);
  const pitchingHand = safe(play?.matchup?.pitchHand?.code);

  const batterName = safe(batter?.fullName, "Unknown Player");
  const pitcherName = safe(pitcher?.fullName);

  const description = safe(play?.result?.description);

  let team = "";
  let opponent = "";

  const isTop = safe(half).toLowerCase() === "top";

  if (isTop) {
    team = away;
    opponent = home;
  } else {
    team = home;
    opponent = away;
  }

  return {
    player: batterName,
    playerId: batter?.id || null,
    team,
    opponent,
    game: `${away} at ${home}`,
    pitcher: pitcherName,
    pitcherId: pitcher?.id || null,
    inning,
    half,
    batSide: battingSide,
    pitcherHand: pitchingHand,
    result: "HR",
    event: "Home Run",
    description,
    did_homer: true
  };
}

async function main() {
  fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });

  const scheduleUrl =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}`;

  const schedule = await getJson(scheduleUrl);

  const games = schedule?.dates?.[0]?.games || [];

  const homeRuns = [];

  for (const game of games) {
    const gamePk = game.gamePk;

    if (!gamePk) continue;

    try {
      const feedUrl =
        `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;

      const feed = await getJson(feedUrl);

      const allPlays = feed?.liveData?.plays?.allPlays || [];

      for (const play of allPlays) {
        if (!isHomeRun(play)) continue;

        homeRuns.push(parseHomeRun(play, feed?.gameData || {}));
      }
    } catch (err) {
      console.log("Skipped game:", gamePk, err.message);
    }
  }

  const output = {
    updatedAt: new Date().toISOString(),
    date: today,
    source: "MLB Stats API live feed",
    count: homeRuns.length,
    homeRuns,
    results: homeRuns
  };

  fs.writeFileSync(OUTFILE, JSON.stringify(output, null, 2));

  console.log("HR RESULTS COMPLETE");
  console.log("Date:", today);
  console.log("Home Runs:", homeRuns.length);
  console.log("Saved:", OUTFILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
