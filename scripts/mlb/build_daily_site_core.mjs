import fs from "fs";
import path from "path";

const root = process.cwd();
const dataDir = path.join(root, "website", "data");

function readJson(name, fallback) {
  try {
    const file = path.join(dataDir, name);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(name, payload) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(payload, null, 2));
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.allPlayers)) return payload.allPlayers;
  if (Array.isArray(payload.players)) return payload.players;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.matchups)) return payload.matchups;
  return [];
}

function text(value) {
  return String(value || "").trim();
}

function norm(value) {
  return text(value).toLowerCase();
}

function scoreOf(row) {
  return Number(row.score ?? row.hrConfidence ?? row.powerScore ?? 0);
}

const gamesPayload = readJson("mlb_games_today.json", {});
const games = rows(gamesPayload);
const hrRows = rows(readJson("mlb_home_runs.json", [])).map(row => ({ ...row, sourceRank: 1 }));
const decisionRows = rows(readJson("hr_decision_center.json", {})).map(row => ({ ...row, sourceRank: 2 }));
const weatherRows = rows(readJson("mlb_weather.json", {}));
const today = gamesPayload.date || new Date().toISOString().slice(0, 10);

function weatherFor(game) {
  return weatherRows.find(w => norm(w.venue) === norm(game.venue)) || null;
}

function convertHitter(row, team, opponent, pitcher) {
  const hitterStats = row.stats?.hitter || row.hitterStats || {};

  return {
    ...row,
    rank: row.rank || null,
    player: row.player || row.name || "",
    playerId: row.playerId || null,
    team: row.team || team,
    opponent: row.opponent || opponent,
    batSide: row.batSide || row.batSideDescription || "",
    opposingPitcher: row.opposingPitcher || row.pitcher || pitcher || "",
    score: row.score ?? row.hrConfidence ?? row.powerScore ?? null,
    edge: row.edge || row.tier || "Watch",
    note: Array.isArray(row.reasons) ? row.reasons.join(" + ") : row.note || "power plus matchup fit",
    stats: row.stats || {},
    hitterStats: {
      ...hitterStats,
      hr: hitterStats.hr ?? row.hr ?? row.homeRuns,
      avg: hitterStats.avg ?? row.avg,
      obp: hitterStats.obp ?? row.obp,
      slg: hitterStats.slg ?? row.slg,
      ops: hitterStats.ops ?? row.ops,
      rbi: hitterStats.rbi ?? row.rbi,
      hits: hitterStats.hits ?? row.hits,
      doubles: hitterStats.doubles ?? row.doubles,
      triples: hitterStats.triples ?? row.triples,
      strikeOuts: hitterStats.strikeOuts ?? row.strikeOuts
    }
  };
}

function uniqueAndSort(list) {
  const seen = new Set();
  return list
    .sort((a, b) => (a.sourceRank || 99) - (b.sourceRank || 99))
    .filter(row => {
      const key = norm(row.player);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .slice(0, 13);
}

function hittersFor(team, opponent, pitcher) {
  const teamKey = norm(team);
  const opponentKey = norm(opponent);
  const source = [...hrRows, ...decisionRows].filter(row => norm(row.team) === teamKey);

  const opponentMatched = source.filter(row => {
    const rowOpponent = norm(row.opponent);
    const rowGame = norm(row.game || row.matchup);
    return opponentKey && (rowOpponent === opponentKey || rowGame.includes(opponentKey));
  });

  const chosen = opponentMatched.length ? opponentMatched : source;

  return uniqueAndSort(chosen.map(row => convertHitter(row, team, opponent, pitcher)));
}

function pitcherVulnerability(hitters) {
  if (!hitters.length) return 0;
  const topFive = hitters.slice(0, 5);
  const avgScore = topFive.reduce((sum, row) => sum + scoreOf(row), 0) / topFive.length;
  return Math.round(avgScore * 10) / 10;
}

const matchups = games.map(game => {
  const awayPitcherName = game.awayProbablePitcher || "TBD";
  const homePitcherName = game.homeProbablePitcher || "TBD";
  const awayHitters = hittersFor(game.awayTeam, game.homeTeam, homePitcherName);
  const homeHitters = hittersFor(game.homeTeam, game.awayTeam, awayPitcherName);
  const awayPitcherVulnerability = pitcherVulnerability(homeHitters);
  const homePitcherVulnerability = pitcherVulnerability(awayHitters);
  const topScore = Math.max(awayPitcherVulnerability, homePitcherVulnerability);

  return {
    gamePk: game.gamePk,
    date: today,
    gameDate: game.gameDate,
    status: game.status || "",
    abstractStatus: game.abstractStatus || "",
    matchup: game.matchup || `${game.awayTeam} at ${game.homeTeam}`,
    venue: game.venue || "",
    venueId: game.venueId || null,
    awayTeam: game.awayTeam || "",
    awayTeamId: game.awayTeamId || null,
    homeTeam: game.homeTeam || "",
    homeTeamId: game.homeTeamId || null,
    awayPitcher: {
      name: awayPitcherName,
      id: game.awayProbablePitcherId || null,
      side: game.awayPitcherHand || game.awayProbablePitcherHand || "",
      vulnerability: awayPitcherVulnerability
    },
    homePitcher: {
      name: homePitcherName,
      id: game.homeProbablePitcherId || null,
      side: game.homePitcherHand || game.homeProbablePitcherHand || "",
      vulnerability: homePitcherVulnerability
    },
    awayLineupStatus: game.awayLineupStatus || "",
    homeLineupStatus: game.homeLineupStatus || "",
    lineupLockStatus: game.lineupLockStatus || "Lineups Updating",
    awayBattingOrder: game.awayBattingOrder || [],
    homeBattingOrder: game.homeBattingOrder || [],
    weather: weatherFor(game),
    topVulnerability: topScore,
    hitters: {
      away: awayHitters,
      home: homeHitters
    }
  };
});

const payload = {
  date: today,
  source: "The Slip Lab daily matchup builder",
  updatedAt: new Date().toISOString(),
  count: matchups.length,
  matchups
};

writeJson("game_pitcher_matchups.json", payload);
writeJson("mlb_games_live.json", {
  date: today,
  source: payload.source,
  updatedAt: payload.updatedAt,
  gameCount: matchups.length,
  games: matchups
});
writeJson("site_last_updated.json", {
  updatedAt: payload.updatedAt,
  updated_at: payload.updatedAt,
  source: "build_daily_site_core"
});

console.log("DAILY SITE CORE COMPLETE");
console.log("Date:", today);
console.log("Games:", matchups.length);
console.log("Hitters attached:", matchups.reduce((sum, game) => sum + game.hitters.away.length + game.hitters.home.length, 0));
console.log("Saved: website/data/game_pitcher_matchups.json");
