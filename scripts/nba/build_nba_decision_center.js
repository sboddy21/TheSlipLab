import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const POINTS_FILE = path.join(ROOT, "website/data/nba_points.json");
const MATCHUP_FILE = path.join(ROOT, "website/data/nba_matchup_engine.json");
const REBOUNDS_FILE = path.join(ROOT, "website/data/nba_rebounds.json");
const ASSISTS_FILE = path.join(ROOT, "website/data/nba_assists.json");
const THREES_FILE = path.join(ROOT, "website/data/nba_threes.json");
const OUT = path.join(ROOT, "website/data/nba_decision_center.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    return null;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(v) {
  return Math.round(num(v) * 10) / 10;
}

function tagList(row) {
  return Array.isArray(row.tags) ? row.tags : [];
}

function hasTag(row, text) {
  return tagList(row).some(t => String(t).toLowerCase().includes(String(text).toLowerCase()));
}

function compact(row, reason = "", matchupMap = new Map()) {
  const matchup = matchupMap.get(String(row.playerId)) || {};
  return {
    rank: row.rank,
    playerId: row.playerId,
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    position: row.position,
    homeAway: row.homeAway,
    pointsScore: round1(row.pointsScore),
    confidence: row.confidence,
    pointsLean: round1(row.pointsLean),
    seasonPoints: round1(row.seasonPoints),
    last5Points: round1(row.last5Points),
    last10Points: round1(row.last10Points),
    trendDiff: round1(row.trendDiff),
    expectedMinutes: round1(row.expectedMinutes),
    minutesConfidence: round1(row.minutesConfidence),
    minutesRole: row.minutesRole,
    minutesTrend: round1(row.minutesTrend),
    usageScore: round1(row.usageScore),
    usageTier: row.usageTier,
    usageTrend: row.usageTrend,
    volumeTrend: round1(row.volumeTrend),
    fgaTrend: round1(row.fgaTrend),
    ftaTrend: round1(row.ftaTrend),
    scoringRole: row.scoringRole,

    matchupScore: round1(matchup.matchupScore),
    matchupTier: matchup.matchupTier || "",
    opponentContext: matchup.opponentContext || "",
    paceContext: matchup.paceContext || "",
    defense: matchup.defense || null,

    reason,
    tags: [...new Set([
      ...tagList(row),
      ...(Array.isArray(matchup.tags) ? matchup.tags : [])
    ])].slice(0, 14)
  };
}

function sortByScore(rows) {
  return rows.slice().sort((a, b) =>
    num(b.pointsScore) - num(a.pointsScore) ||
    num(b.pointsLean) - num(a.pointsLean) ||
    num(b.usageScore) - num(a.usageScore) ||
    num(b.expectedMinutes) - num(a.expectedMinutes) ||
    String(a.player).localeCompare(String(b.player))
  );
}

function top(rows, n = 10) {
  return rows.slice(0, n);
}

function compactMarket(row, market, scoreKey, leanKey, reason = "") {
  return {
    rank: row.rank,
    playerId: row.playerId,
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    position: row.position,
    homeAway: row.homeAway,
    market,
    marketScore: round1(row[scoreKey]),
    marketLean: round1(row[leanKey]),
    confidence: row.confidence,
    expectedMinutes: round1(row.expectedMinutes),
    minutesConfidence: round1(row.minutesConfidence),
    minutesRole: row.minutesRole,
    trendDiff: round1(row.trendDiff),
    role:
      row.reboundRole ||
      row.assistRole ||
      row.threesRole ||
      "",
    reason,
    tags: Array.isArray(row.tags) ? row.tags.slice(0, 8) : []
  };
}

function overallScore(row, matchupMap = new Map()) {
  const matchup = matchupMap.get(String(row.playerId)) || {};
  return round1(
    num(row.pointsScore) * 0.36 +
    num(row.pointsLean) * 1.15 +
    num(row.usageScore) * 0.18 +
    num(row.expectedMinutes) * 0.42 +
    num(matchup.matchupScore) * 0.22
  );
}

function buildSections(players, matchupMap, reboundsRows = [], assistsRows = [], threesRows = []) {
  const active = players.filter(p => String(p.status || "").toUpperCase() === "ACTIVE");

  const topOverallPlays = top(
    active.slice().sort((a, b) =>
      overallScore(b, matchupMap) - overallScore(a, matchupMap) ||
      num(b.pointsScore) - num(a.pointsScore) ||
      String(a.player).localeCompare(String(b.player))
    ),
    10
  ).map(p => ({
    ...compact(p, "Best overall blend of projection, model score, usage, minutes, form, and matchup context.", matchupMap),
    overallScore: overallScore(p, matchupMap)
  }));

  const pickOnePool = topOverallPlays
    .filter(p =>
      num(p.pointsLean) >= 15 &&
      num(p.expectedMinutes) >= 28 &&
      num(p.minutesConfidence) >= 75
    )
    .slice(0, 6)
    .map((p, index) => ({
      ...p,
      rank: index + 1,
      pickOneLabel: "I Can Only Pick One",
      reason: "Best single-player shortlist based on projection, overall score, minutes, usage, form, and matchup context."
    }));

  const bestPointsPlays = top(sortByScore(active), 10)
    .map(p => compact(p, "Best blend of points score, scoring lean, minutes, usage, recent form, and matchup context.", matchupMap));

  const usageRisers = top(sortByScore(active.filter(p =>
    p.usageTrend === "Usage Spike" ||
    p.usageTrend === "Usage Up" ||
    num(p.volumeTrend) >= 4 ||
    hasTag(p, "Volume Acceleration")
  )), 10).map(p => compact(p, "Usage and shot volume are moving in the right direction.", matchupMap));

  const minutesMonsters = top(sortByScore(active.filter(p =>
    num(p.expectedMinutes) >= 32 &&
    num(p.minutesConfidence) >= 85
  )), 10).map(p => compact(p, "High projected minutes with strong minute confidence.", matchupMap));

  const scoringForm = top(sortByScore(active.filter(p =>
    num(p.trendDiff) >= 3 ||
    num(p.last5Points) >= num(p.seasonPoints) + 3 ||
    num(p.last10Points) >= num(p.seasonPoints) + 2
  )), 10).map(p => compact(p, "Recent scoring form is ahead of season baseline.", matchupMap));

  const safeFloor = top(sortByScore(active.filter(p =>
    num(p.expectedMinutes) >= 30 &&
    num(p.minutesConfidence) >= 85 &&
    num(p.usageScore) >= 50 &&
    num(p.pointsLean) >= 15
  )), 10).map(p => compact(p, "Stable minutes, usable offensive role, reliable scoring lean, and matchup context.", matchupMap));

  const boomCandidates = top(sortByScore(active.filter(p =>
    num(p.trendDiff) >= 4 ||
    p.usageTrend === "Usage Spike" ||
    num(p.volumeTrend) >= 5 ||
    num(p.fgaTrend) >= 3 ||
    num(p.ftaTrend) >= 2
  )), 10).map(p => compact(p, "Ceiling profile boosted by form, usage spike, volume acceleration, or matchup context.", matchupMap));

  const watchList = top(sortByScore(active.filter(p =>
    num(p.pointsScore) >= 55 &&
    num(p.pointsScore) < 70
  )), 10).map(p => compact(p, "Not top tier yet, but close enough to monitor.", matchupMap));

  const trueDefenseTargets = sortByScore(active.filter(p => {
    const m = matchupMap.get(String(p.playerId)) || {};
    const rank = num(m.defense?.rankPointsAllowed);
    return rank >= 21 || (Array.isArray(m.tags) && m.tags.includes("Defense Target"));
  }));

  const availableDefenseTargets = sortByScore(active.filter(p => {
    const m = matchupMap.get(String(p.playerId)) || {};
    const rank = num(m.defense?.rankPointsAllowed);
    return rank > 10;
  }));

  const defenseTargetPool = trueDefenseTargets.length
    ? trueDefenseTargets
    : availableDefenseTargets.length
      ? availableDefenseTargets
      : sortByScore(active);

  const defenseTargets = top(defenseTargetPool, 10).map(p => {
    const m = matchupMap.get(String(p.playerId)) || {};
    const rank = num(m.defense?.rankPointsAllowed);
    const reason = rank >= 21
      ? "Opponent defense profile is favorable based on points allowed data."
      : rank > 10
        ? "Best available defense target on this slate. Opponent is not a top 10 points defense."
        : "Fallback defense target because this slate has mostly tough points defenses.";

    return compact(p, reason, matchupMap);
  });

  const toughDefenseWarnings = top(sortByScore(active.filter(p => {
    const m = matchupMap.get(String(p.playerId)) || {};
    const rank = num(m.defense?.rankPointsAllowed);
    return rank > 0 && rank <= 10;
  })), 10).map(p => compact(p, "Opponent is a tougher points defense based on allowed points rank.", matchupMap));

  const topRebounds = top(reboundsRows, 10)
    .map(p => compactMarket(p, "Rebounds", "reboundsScore", "reboundsLean", "Best rebound profile from rebounds score, rebound lean, minutes, role, and recent trend."));

  const topAssists = top(assistsRows, 10)
    .map(p => compactMarket(p, "Assists", "assistsScore", "assistsLean", "Best assist profile from assists score, assist lean, minutes, usage, and recent trend."));

  const topThrees = top(threesRows, 10)
    .map(p => compactMarket(p, "Threes", "threesScore", "threesLean", "Best three point profile from threes score, threes lean, attempts, minutes, and trend."));

  const matchupRows = active
    .map(p => ({ player: p, matchup: matchupMap.get(String(p.playerId)) || {} }))
    .filter(x => num(x.matchup.matchupScore) > 0);

  function bestByPosition(position) {
    return top(
      matchupRows
        .filter(x => String(x.player.position || "").toUpperCase() === position)
        .sort((a, b) =>
          num(b.matchup.matchupScore) - num(a.matchup.matchupScore) ||
          num(b.player.pointsScore) - num(a.player.pointsScore)
        )
        .map(x => compact(x.player, `Best ${position} matchup based on matchup score, points profile, minutes, usage, defense, and pace context.`, matchupMap)),
      10
    );
  }

  return {
    topOverallPlays,
    pickOnePool,
    bestPointsPlays,
    usageRisers,
    minutesMonsters,
    scoringForm,
    safeFloor,
    boomCandidates,
    defenseTargets,
    toughDefenseWarnings,
    topRebounds,
    topAssists,
    topThrees,
    bestPGMatchups: bestByPosition("PG"),
    bestSGMatchups: bestByPosition("SG"),
    bestSFMatchups: bestByPosition("SF"),
    bestPFMatchups: bestByPosition("PF"),
    bestCMatchups: bestByPosition("C"),
    watchList
  };
}

async function main() {
  const points = readJSON(POINTS_FILE, { players: [] });
  const matchups = readJSON(MATCHUP_FILE, { players: [] });
  const rebounds = readJSON(REBOUNDS_FILE, { players: [] });
  const assists = readJSON(ASSISTS_FILE, { players: [] });
  const threes = readJSON(THREES_FILE, { players: [] });

  const players = Array.isArray(points.players) ? points.players : [];
  const matchupRows = Array.isArray(matchups.players) ? matchups.players : [];
  const reboundsRows = Array.isArray(rebounds.players) ? rebounds.players : [];
  const assistsRows = Array.isArray(assists.players) ? assists.players : [];
  const threesRows = Array.isArray(threes.players) ? threes.players : [];

  const matchupMap = new Map();
  for (const row of matchupRows) {
    if (row.playerId) matchupMap.set(String(row.playerId), row);
  }

  const sections = buildSections(players, matchupMap, reboundsRows, assistsRows, threesRows);

  const out = {
    sport: "NBA",
    version: "2.0",
    source: "nba_points.json",
    fetchedAt: new Date().toISOString(),
    date: points.date || "",
    season: points.season || "",
    market: "Points",
    playerCount: players.length,
    sectionCount: Object.keys(sections).length,
    modelNotes: [
      "NBA Decision Center 2.0 is built from the NBA Points Board, NBA Matchup Engine, Rebounds Board, Assists Board, and Threes Board.",
      "Sections include top overall plays, I Can Only Pick One, best points plays, usage risers, minutes monsters, scoring form, safe floor, boom candidates, defense targets, tough defense warnings, top rebounds, top assists, top threes, best matchups by position, and watch list.",
      "No odds or betting lines are used."
    ],
    sections
  };

  const existing = readExisting();

const sectionCount =
  Object.values(sections || {})
    .filter(v => Array.isArray(v))
    .reduce((a,b)=>a+b.length,0);

const existingCount =
  Object.values(existing?.sections || {})
    .filter(v => Array.isArray(v))
    .reduce((a,b)=>a+b.length,0);

if (sectionCount === 0 && existingCount > 0) {
  fs.writeFileSync(OUT, JSON.stringify({
    ...existing,
    preservedAt: new Date().toISOString(),
    preserveReason: "Decision Center generated 0 section entries"
  }, null, 2));

  console.log("DECISION CENTER PRESERVED PREVIOUS DATA");
  return;
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA DECISION CENTER COMPLETE");
  console.log("Players:", players.length);
  console.log("Sections:", Object.keys(sections).length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA DECISION CENTER FAILED");
  console.error(err);
  process.exit(1);
});
