import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const FILE = path.join(DATA_DIR, "hr_decision_center.json");

const TEAM_ALIASES = {
  "arizona dbacks": "arizona diamondbacks",
  "az diamondbacks": "arizona diamondbacks",
  "chi white sox": "chicago white sox",
  "cws": "chicago white sox",
  "sf giants": "san francisco giants",
  "sd padres": "san diego padres",
  "kc royals": "kansas city royals",
  "la dodgers": "los angeles dodgers",
  "ny yankees": "new york yankees",
  "ny mets": "new york mets",
  "tb rays": "tampa bay rays",
  "was nationals": "washington nationals"
};

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function norm(v) {
  const x = clean(v)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return TEAM_ALIASES[x] || x;
}

function todayEastern() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;

  return `${y}-${m}-${d}`;
}

async function getSchedule(date) {
  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}` +
    `&hydrate=probablePitcher`;

  const res = await fetch(url, {
    headers: {
      "user-agent": "TheSlipLab/1.0",
      "accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`MLB schedule failed ${res.status}`);
  }

  return await res.json();
}

function buildPitcherMaps(schedule) {
  const gameMap = new Map();
  const opponentMap = new Map();

  const games = schedule?.dates?.flatMap(d => d.games || []) || [];

  for (const game of games) {
    const away = clean(game?.teams?.away?.team?.name);
    const home = clean(game?.teams?.home?.team?.name);

    const awayPitcher =
      clean(game?.teams?.away?.probablePitcher?.fullName) ||
      clean(game?.teams?.away?.probablePitcher?.name) ||
      "TBD";

    const homePitcher =
      clean(game?.teams?.home?.probablePitcher?.fullName) ||
      clean(game?.teams?.home?.probablePitcher?.name) ||
      "TBD";

    if (!away || !home) continue;

    const awayKey = norm(away);
    const homeKey = norm(home);

    gameMap.set(`${awayKey}|${homeKey}`, {
      away,
      home,
      awayPitcher,
      homePitcher
    });

    gameMap.set(`${homeKey}|${awayKey}`, {
      away,
      home,
      awayPitcher,
      homePitcher
    });

    opponentMap.set(`${awayKey}|${homeKey}`, homePitcher);
    opponentMap.set(`${homeKey}|${awayKey}`, awayPitcher);
  }

  return { gameMap, opponentMap, games };
}

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function topUnique(rows, scoreKey, limit = 12) {
  const used = new Set();

  return [...rows]
    .filter(row => row && row.player)
    .sort((a, b) => num(b[scoreKey]) - num(a[scoreKey]))
    .filter(row => {
      const key = clean(row.player).toLowerCase();
      if (used.has(key)) return false;
      used.add(key);
      return true;
    })
    .slice(0, limit);
}

function pickOneScore(row, type) {
  if (type === "safe") {
    return (
      num(row.safetyScore) * 1.25 +
      num(row.hrConfidence) * 3.0 +
      num(row.powerScore) * 0.18 +
      num(row.pitchEdge) * 0.14 +
      num(row.zoneOverlap) * 0.12
    );
  }

  if (type === "ceiling") {
    return (
      num(row.powerScore) * 0.55 +
      num(row.pitcherRisk) * 0.34 +
      num(row.pitchEdge) * 0.26 +
      num(row.weatherScore || row.weather) * 0.22 +
      num(row.bullpenScore || row.bullpen) * 0.16 +
      num(row.multiHrCeilingScore) * 0.45
    );
  }

  if (type === "weather") {
    return (
      num(row.weatherScore || row.weather) * 0.80 +
      num(row.hrConfidence) * 2.2 +
      num(row.powerScore) * 0.24 +
      num(row.pitcherRisk) * 0.18
    );
  }

  if (type === "pitch") {
    return (
      num(row.pitchTypeScore || row.pitchTypeDestructionScore || row.pitchEdge) * 0.75 +
      num(row.pitchEdge) * 0.35 +
      num(row.zoneOverlap) * 0.30 +
      num(row.hrConfidence) * 2.2
    );
  }

  if (type === "longshot") {
    return (
      num(row.lottoScore) * 1.15 +
      num(row.dueScore || row.due) * 0.65 +
      num(row.powerScore) * 0.24 +
      num(row.pitcherRisk) * 0.22 +
      num(row.pitchEdge) * 0.20 +
      num(row.weatherScore || row.weather) * 0.14 -
      num(row.hrConfidence) * 0.65
    );
  }

  return (
    num(row.decisionScore) * 1.15 +
    num(row.hrConfidence) * 3.0 +
    num(row.powerScore) * 0.25 +
    num(row.pitcherRisk) * 0.22 +
    num(row.pitchEdge) * 0.20 +
    num(row.zoneOverlap) * 0.14 +
    num(row.weatherScore || row.weather) * 0.10 +
    num(row.bullpenScore || row.bullpen) * 0.08
  );
}

function shortPick(row, type, label, description) {
  if (!row) return null;

  return {
    label,
    type,
    description,
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    game: row.game,
    hrConfidence: num(row.hrConfidence),
    powerScore: num(row.powerScore),
    pitchEdge: num(row.pitchEdge),
    pitcherRisk: num(row.pitcherRisk),
    weather: num(row.weatherScore || row.weather),
    bullpen: num(row.bullpenScore || row.bullpen),
    due: num(row.dueScore || row.due),
    zoneOverlap: num(row.zoneOverlap),
    bestPitch: row.bestPitch,
    tier: row.tier,
    reasons: row.reasons || [],
    pickOneScore: Number(pickOneScore(row, type).toFixed(1))
  };
}

function topPick(rows, type, used = new Set()) {
  const pick = [...rows]
    .filter(row => row && row.player && !used.has(clean(row.player).toLowerCase()))
    .sort((a, b) => pickOneScore(b, type) - pickOneScore(a, type))[0] || null;

  if (pick?.player) used.add(clean(pick.player).toLowerCase());

  return pick;
}

function buildIfOnlyOne(cards) {
  const usable = cards.filter(row => row && row.player);
  const used = new Set();

  const bestOverall = topPick(usable, "overall", used);
  const safestPlay = topPick(usable, "safe", used);
  const highestCeiling = topPick(usable, "ceiling", used);
  const bestWeatherPlay = topPick(usable, "weather", used);
  const bestPitchMatchup = topPick(usable, "pitch", used);

  const longshotPool = usable.filter(row => num(row.hrConfidence) < 35 || num(row.lottoScore) > 0 || num(row.dueScore) > 0);
  const bestLongshot = topPick(longshotPool.length ? longshotPool : usable, "longshot", used);

  return {
    title: "If I Can Only Pick One",
    updatedAt: new Date().toISOString(),
    picks: {
      bestOverall: shortPick(bestOverall, "overall", "Best Overall HR Pick", "Best blend of power, matchup, zone overlap, pitcher risk, and environment."),
      safestPlay: shortPick(safestPlay, "safe", "Safest HR Look", "Strongest profile when confidence, zones, and matchup stability are weighted heavier."),
      highestCeiling: shortPick(highestCeiling, "ceiling", "Highest Ceiling", "Biggest raw upside profile when power, pitcher vulnerability, and ceiling traits line up."),
      bestWeatherPlay: shortPick(bestWeatherPlay, "weather", "Best Weather Play", "Best HR profile with weather and park carry weighted heavily."),
      bestPitchMatchup: shortPick(bestPitchMatchup, "pitch", "Best Pitch Matchup", "Best hitter versus the projected pitch mix and pitcher attack profile."),
      bestLongshot: shortPick(bestLongshot, "longshot", "Best Longshot", "Lower confidence bat with enough power, pitch edge, zones, or weather to stay live.")
    }
  };
}

function rebuildSections(cards) {
  return {
    ifOnlyOne: buildIfOnlyOne(cards),
    bestPicks: topUnique(cards, "decisionScore"),
    safestPlays: topUnique(cards, "safetyScore"),
    lottoBombs: topUnique(cards.filter(x => num(x.lottoScore) > 0), "lottoScore"),
    dueForHr: topUnique(cards.filter(x => num(x.dueScore) > 0), "dueScore"),
    pitchTypeEdges: topUnique(cards.filter(x => num(x.pitchTypeScore) > 0), "pitchTypeScore"),
    weatherCarry: topUnique(cards.filter(x => num(x.weatherScore) > 0), "weatherScore"),
    bullpenBoosts: topUnique(cards.filter(x => num(x.bullpenScore) > 0), "bullpenScore")
  };
}

function enrichRow(row, opponentMap) {
  const team = norm(row.team);
  const opponent = norm(row.opponent || row.awayTeam || row.homeTeam);

  const pitcher =
    opponentMap.get(`${team}|${opponent}`) ||
    opponentMap.get(`${opponent}|${team}`) ||
    clean(row.pitcher) ||
    clean(row.opposingPitcher) ||
    "TBD";

  return {
    ...row,
    pitcher,
    opposingPitcher: pitcher,
    probablePitcher: pitcher,
    pitcherStatus: pitcher === "TBD" ? "TBD" : "Probable"
  };
}

async function main() {
  if (!fs.existsSync(FILE)) {
    throw new Error(`Missing ${FILE}`);
  }

  const date = todayEastern();
  const schedule = await getSchedule(date);
  const { opponentMap, games } = buildPitcherMaps(schedule);

  const json = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const cards = (json.allPlayers || []).map(row => enrichRow(row, opponentMap));

  const output = {
    ...json,
    updatedAt: new Date().toISOString(),
    pitcherSource: "MLB Stats API probablePitcher",
    pitcherDate: date,
    pitcherDebug: {
      scheduleGames: games.length,
      pitcherPairs: opponentMap.size,
      players: cards.length,
      withPitchers: cards.filter(x => x.pitcher && x.pitcher !== "TBD").length,
      tbd: cards.filter(x => !x.pitcher || x.pitcher === "TBD").length
    },
    sections: rebuildSections(cards),
    allPlayers: cards
  };

  fs.writeFileSync(FILE, JSON.stringify(output, null, 2));

  console.log("HR DECISION CENTER PITCHERS ENRICHED");
  console.log(output.pitcherDebug);
  console.log("Saved:", FILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
