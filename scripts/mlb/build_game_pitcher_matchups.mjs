import fs from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "website", "data");

function readJSON(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(DATA, file), "utf8")
    );
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(
    path.join(DATA, file),
    JSON.stringify(data, null, 2)
  );
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.players)) return data.players;
  if (Array.isArray(data.games)) return data.games;
  if (Array.isArray(data.rows)) return data.rows;
  return [];
}

function clean(v, fallback="") {
  if (v === undefined || v === null || v === "") return fallback;
  return String(v);
}

function norm(v="") {
  return clean(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g,"");
}

function num(v, fallback=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const profilesData = readJSON(
  "player_card_profiles.json",
  { players: [] }
);

const profiles = rows(profilesData);

const gamesData = readJSON(
  "mlb_games_today.json",
  []
);

const games = rows(gamesData);

const grouped = new Map();

for (const p of profiles) {
  const game = clean(p.game);

  if (!grouped.has(game)) {
    grouped.set(game, []);
  }

  grouped.get(game).push(p);
}

const finalGames = [];

for (const [gameName, bats] of grouped.entries()) {

  const sample = bats[0] || {};

  const awayTeam =
    gameName.split(" at ")[0] ||
    "";

  const homeTeam =
    gameName.split(" at ")[1] ||
    "";

  const awayBats = bats.filter(
    b => norm(b.team) === norm(awayTeam)
  );

  const homeBats = bats.filter(
    b => norm(b.team) === norm(homeTeam)
  );

  const awayPitchers = {};
  const homePitchers = {};

  for (const b of awayBats) {
    const pitcher = clean(b.pitcher);

    if (
      pitcher &&
      pitcher !== "TBD" &&
      pitcher !== "Probable SP Pending"
    ) {
      if (!homePitchers[pitcher]) {
        homePitchers[pitcher] = {
          name: pitcher,
          era: b.pitcherStats?.era ?? 0,
          whip: b.pitcherStats?.whip ?? 0,
          strikeOuts: b.pitcherStats?.strikeOuts ?? 0,
          inningsPitched: b.pitcherStats?.inningsPitched ?? 0,
          homeRuns: b.pitcherStats?.homeRuns ?? 0
        };
      }
    }
  }

  for (const b of homeBats) {
    const pitcher = clean(b.pitcher);

    if (
      pitcher &&
      pitcher !== "TBD" &&
      pitcher !== "Probable SP Pending"
    ) {
      if (!awayPitchers[pitcher]) {
        awayPitchers[pitcher] = {
          name: pitcher,
          era: b.pitcherStats?.era ?? 0,
          whip: b.pitcherStats?.whip ?? 0,
          strikeOuts: b.pitcherStats?.strikeOuts ?? 0,
          inningsPitched: b.pitcherStats?.inningsPitched ?? 0,
          homeRuns: b.pitcherStats?.homeRuns ?? 0
        };
      }
    }
  }

  const awayPitcher =
    Object.values(awayPitchers)[0] ||
    {
      name: "Pitcher Not Loaded",
      era: 0,
      whip: 0,
      strikeOuts: 0,
      inningsPitched: 0,
      homeRuns: 0
    };

  const homePitcher =
    Object.values(homePitchers)[0] ||
    {
      name: "Pitcher Not Loaded",
      era: 0,
      whip: 0,
      strikeOuts: 0,
      inningsPitched: 0,
      homeRuns: 0
    };

  finalGames.push({
    game: gameName,
    awayTeam,
    homeTeam,
    venue: sample.venue || "",
    awayPitcher: {
      pitcher: awayPitcher.name,
      era: awayPitcher.era,
      whip: awayPitcher.whip,
      strikeOuts: awayPitcher.strikeOuts,
      inningsPitched: awayPitcher.inningsPitched,
      homeRuns: awayPitcher.homeRuns,
      topThreats: homeBats
        .sort((a,b)=>num(b.score)-num(a.score))
        .slice(0,5)
        .map(p=>({
          player:p.player,
          score:p.score
        }))
    },
    homePitcher: {
      pitcher: homePitcher.name,
      era: homePitcher.era,
      whip: homePitcher.whip,
      strikeOuts: homePitcher.strikeOuts,
      inningsPitched: homePitcher.inningsPitched,
      homeRuns: homePitcher.homeRuns,
      topThreats: awayBats
        .sort((a,b)=>num(b.score)-num(a.score))
        .slice(0,5)
        .map(p=>({
          player:p.player,
          score:p.score
        }))
    }
  });
}

writeJSON(
  "mlb_game_pitcher_matchups.json",
  {
    updatedAt:new Date().toISOString(),
    count:finalGames.length,
    games:finalGames
  }
);

console.log("");
console.log("FIXED GAME MATCHUPS");
console.log("Games:", finalGames.length);

for (const g of finalGames.slice(0,5)) {
  console.log(
    g.game,
    "|",
    g.awayPitcher.pitcher,
    "vs",
    g.homePitcher.pitcher
  );
}
