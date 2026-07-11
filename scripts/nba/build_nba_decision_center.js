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

function edgeTags(row, matchup = {}) {
  const tags = [];

  if (num(row.pointsScore) >= 88 || num(row.marketScore) >= 88) tags.push("Smash Spot");
  if (num(row.expectedMinutes) >= 34) tags.push("Core Minutes");
  if (num(row.expectedMinutes) >= 30 && num(row.minutesConfidence) >= 85) tags.push("Minutes Boost");
  if (row.usageTrend === "Usage Spike") tags.push("Usage Spike");
  if (row.usageTrend === "Usage Up") tags.push("Usage Up");
  if (num(row.volumeTrend) >= 4) tags.push("Volume Up");
  if (num(row.trendDiff) >= 3) tags.push("Hot Form");
  if (num(row.pointsLean || row.marketLean) >= 25) tags.push("High Projection");
  if (num(row.pointsLean || row.marketLean) >= 15 && num(row.expectedMinutes) >= 30) tags.push("Safe Floor");

  if (num(matchup.matchupScore) >= 80) tags.push("Elite Matchup");
  if (num(matchup.matchupScore) >= 70) tags.push("Strong Matchup");
  if (num(matchup.defense?.rankPointsAllowed) >= 21) tags.push("Defense Edge");
  if (num(matchup.defense?.rankPointsAllowed) <= 10 && num(matchup.defense?.rankPointsAllowed) > 0) tags.push("Tough Defense");
  if (num(matchup.pace?.rankPace) <= 10 && num(matchup.pace?.rankPace) > 0) tags.push("Pace Boost");
  if (num(matchup.pace?.rankPace) >= 22) tags.push("Slow Pace");

  if (tags.includes("Usage Spike") && tags.includes("Core Minutes")) tags.push("Usage + Minutes");
  if (tags.includes("Hot Form") && tags.includes("High Projection")) tags.push("Boom Profile");

  return tags;
}


function marketMaps(pointsRows = [], reboundsRows = [], assistsRows = [], threesRows = []) {
  const maps = {
    points: new Map(),
    rebounds: new Map(),
    assists: new Map(),
    threes: new Map()
  };

  pointsRows.forEach(r => maps.points.set(String(r.playerId), r));
  reboundsRows.forEach(r => maps.rebounds.set(String(r.playerId), r));
  assistsRows.forEach(r => maps.assists.set(String(r.playerId), r));
  threesRows.forEach(r => maps.threes.set(String(r.playerId), r));

  return maps;
}

function attachBestMarket(row, maps = {}) {
  const id = String(row.playerId);

  const pointsRow = maps.points?.get(id) || {};
  const reboundsRow = maps.rebounds?.get(id) || {};
  const assistsRow = maps.assists?.get(id) || {};
  const threesRow = maps.threes?.get(id) || {};

  const pointsScore = round1(pointsRow.pointsScore ?? row.pointsScore);
  const reboundsScore = round1(reboundsRow.reboundsScore);
  const assistsScore = round1(assistsRow.assistsScore);
  const threesScore = round1(threesRow.threesScore);

  const pointsLean = round1(pointsRow.pointsLean ?? row.pointsLean);
  const reboundsLean = round1(reboundsRow.reboundsLean);
  const assistsLean = round1(assistsRow.assistsLean);
  const threesLean = round1(threesRow.threesLean);

  const praScore = round1(
    pointsScore * 0.45 +
    reboundsScore * 0.30 +
    assistsScore * 0.25
  );

  const markets = [
    {
      key: "points",
      label: "POINTS OVER",
      score: pointsScore,
      lean: pointsLean,
      projection: pointsLean,
      projectionLabel: "Projected Points"
    },
    {
      key: "rebounds",
      label: "REBOUNDS OVER",
      score: reboundsScore,
      lean: reboundsLean,
      projection: reboundsLean,
      projectionLabel: "Projected Rebounds"
    },
    {
      key: "assists",
      label: "ASSISTS OVER",
      score: assistsScore,
      lean: assistsLean,
      projection: assistsLean,
      projectionLabel: "Projected Assists"
    },
    {
      key: "threes",
      label: "3PT OVER",
      score: threesScore,
      lean: threesLean,
      projection: threesLean,
      projectionLabel: "Projected Threes"
    },
    {
      key: "pra",
      label: "PRA OVER",
      score: praScore,
      lean: round1(pointsLean + reboundsLean + assistsLean),
      projection: round1(pointsLean + reboundsLean + assistsLean),
      projectionLabel: "Projected PRA"
    }
  ].filter(m => num(m.score) > 0);

  const best = markets.sort((a, b) =>
    num(b.score) - num(a.score) ||
    num(b.lean) - num(a.lean)
  )[0] || { key: "points", label: "POINTS OVER", score: pointsScore, lean: pointsLean };

  return {
    ...row,
    pointsScore,
    reboundsScore,
    assistsScore,
    threesScore,
    praScore,
    pointsLean,
    reboundsLean,
    assistsLean,
    threesLean,
    bestMarket: best.key,
    bestMarketLabel: best.label,
    bestMarketScore: round1(best.score),
    bestMarketLean: round1(best.lean),
    bestMarketProjection: round1(best.projection),
    bestMarketProjectionLabel: best.projectionLabel
  };
}


function compact(row, reason = "", matchupMap = new Map(), maps = {}) {
  const matchup = matchupMap.get(String(row.playerId)) || {};
  row = attachBestMarket(row, maps);
  const enriched = attachBestMarket(row, maps);

  return {
    rank: row.rank,
    playerId: row.playerId,
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    position: row.position,
    homeAway: row.homeAway,
    pointsScore: round1(row.pointsScore),
    reboundsScore: round1(row.reboundsScore),
    assistsScore: round1(row.assistsScore),
    threesScore: round1(row.threesScore),
    praScore: round1(row.praScore),
    bestMarket: row.bestMarket,
    bestMarketLabel: row.bestMarketLabel,
    bestMarketScore: round1(row.bestMarketScore),
    bestMarketLean: round1(row.bestMarketLean),
    bestMarketProjection: round1(row.bestMarketProjection),
    bestMarketProjectionLabel: row.bestMarketProjectionLabel,
    confidence: row.confidence,
    pointsLean: round1(row.pointsLean),
    reboundsLean: round1(row.reboundsLean),
    assistsLean: round1(row.assistsLean),
    threesLean: round1(row.threesLean),
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
      ...edgeTags(row, matchup),
      ...tagList(row),
      ...(Array.isArray(matchup.tags) ? matchup.tags : [])
    ])].slice(0, 18)
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

function compactMarket(row, market, scoreKey, leanKey, reason = "", maps = {}) {
  const synthetic = {
    ...row,
    marketScore: row[scoreKey],
    marketLean: row[leanKey]
  };

  const enriched = attachBestMarket(row, maps);

  return {
    rank: row.rank,
    pointsScore: round1(enriched.pointsScore),
    reboundsScore: round1(enriched.reboundsScore),
    assistsScore: round1(enriched.assistsScore),
    threesScore: round1(enriched.threesScore),
    praScore: round1(enriched.praScore),
    bestMarket: enriched.bestMarket,
    bestMarketLabel: enriched.bestMarketLabel,
    bestMarketScore: round1(enriched.bestMarketScore),
    bestMarketLean: round1(enriched.bestMarketLean),
    bestMarketProjection: round1(enriched.bestMarketProjection),
    bestMarketProjectionLabel: enriched.bestMarketProjectionLabel,
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
    tags: [...new Set([
      ...edgeTags(synthetic, {}),
      ...(Array.isArray(row.tags) ? row.tags : [])
    ])].slice(0, 14)
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
  const maps = marketMaps(active, reboundsRows, assistsRows, threesRows);

  const topOverallPlays = top(
    active.slice().sort((a, b) =>
      overallScore(b, matchupMap) - overallScore(a, matchupMap) ||
      num(b.pointsScore) - num(a.pointsScore) ||
      String(a.player).localeCompare(String(b.player))
    ),
    10
  ).map(p => ({
    ...compact(p, "Best overall blend of projection, model score, usage, minutes, form, and matchup context.", matchupMap, maps),
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
    .map(p => compact(p, "Best blend of points score, scoring lean, minutes, usage, recent form, and matchup context.", matchupMap, maps));

  const usageRisers = top(sortByScore(active.filter(p =>
    p.usageTrend === "Usage Spike" ||
    p.usageTrend === "Usage Up" ||
    num(p.volumeTrend) >= 4 ||
    hasTag(p, "Volume Acceleration")
  )), 10).map(p => compact(p, "Usage and shot volume are moving in the right direction.", matchupMap, maps));

  const minutesMonsters = top(sortByScore(active.filter(p =>
    num(p.expectedMinutes) >= 32 &&
    num(p.minutesConfidence) >= 85
  )), 10).map(p => compact(p, "High projected minutes with strong minute confidence.", matchupMap, maps));

  const scoringForm = top(sortByScore(active.filter(p =>
    num(p.trendDiff) >= 3 ||
    num(p.last5Points) >= num(p.seasonPoints) + 3 ||
    num(p.last10Points) >= num(p.seasonPoints) + 2
  )), 10).map(p => compact(p, "Recent scoring form is ahead of season baseline.", matchupMap, maps));

  const safeFloor = top(sortByScore(active.filter(p =>
    num(p.expectedMinutes) >= 30 &&
    num(p.minutesConfidence) >= 85 &&
    num(p.usageScore) >= 50 &&
    num(p.pointsLean) >= 15
  )), 10).map(p => compact(p, "Stable minutes, usable offensive role, reliable scoring lean, and matchup context.", matchupMap, maps));

  const boomCandidates = top(sortByScore(active.filter(p =>
    num(p.trendDiff) >= 4 ||
    p.usageTrend === "Usage Spike" ||
    num(p.volumeTrend) >= 5 ||
    num(p.fgaTrend) >= 3 ||
    num(p.ftaTrend) >= 2
  )), 10).map(p => compact(p, "Ceiling profile boosted by form, usage spike, volume acceleration, or matchup context.", matchupMap, maps));

  const watchList = top(sortByScore(active.filter(p =>
    num(p.pointsScore) >= 55 &&
    num(p.pointsScore) < 70
  )), 10).map(p => compact(p, "Not top tier yet, but close enough to monitor.", matchupMap, maps));

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

    return compact(p, reason, matchupMap, maps);
  });

  const toughDefenseWarnings = top(sortByScore(active.filter(p => {
    const m = matchupMap.get(String(p.playerId)) || {};
    const rank = num(m.defense?.rankPointsAllowed);
    return rank > 0 && rank <= 10;
  })), 10).map(p => compact(p, "Opponent is a tougher points defense based on allowed points rank.", matchupMap, maps));

  const topRebounds = top(reboundsRows, 10)
    .map(p => compactMarket(p, "Rebounds", "reboundsScore", "reboundsLean", "Best rebound profile from rebounds score, rebound lean, minutes, role, and recent trend.", maps));

  const topAssists = top(assistsRows, 10)
    .map(p => compactMarket(p, "Assists", "assistsScore", "assistsLean", "Best assist profile from assists score, assist lean, minutes, usage, and recent trend.", maps));

  const topThrees = top(threesRows, 10)
    .map(p => compactMarket(p, "Threes", "threesScore", "threesLean", "Best three point profile from threes score, threes lean, attempts, minutes, and trend.", maps));

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
        .map(x => compact(x.player, `Best ${position} matchup based on matchup score, points profile, minutes, usage, defense, and pace context.`, matchupMap, maps)),
      10
    );
  }

  const topPG = bestByPosition("PG");
  const topSG = bestByPosition("SG");
  const topSF = bestByPosition("SF");
  const topPF = bestByPosition("PF");
  const topC = bestByPosition("C");

  return {
    topOverallPlays,
    pickOnePool,
    topPG,
    topSG,
    topSF,
    topPF,
    topC,
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
    bestPGMatchups: topPG,
    bestSGMatchups: topSG,
    bestSFMatchups: topSF,
    bestPFMatchups: topPF,
    bestCMatchups: topC,
    watchList
  };
}


function buildConsensusSection(sections) {
  const watchedSections = [
    ["topOverallPlays", "Overall"],
    ["pickOnePool", "Pick One"],
    ["bestPointsPlays", "Points"],
    ["topRebounds", "Rebounds"],
    ["topAssists", "Assists"],
    ["topThrees", "Threes"],
    ["defenseTargets", "Defense Target"],
    ["minutesMonsters", "Minutes"],
    ["usageRisers", "Usage"],
    ["boomCandidates", "Boom"],
    ["safeFloor", "Safe Floor"]
  ];

  const byPlayer = new Map();

  for (const [sectionKey, label] of watchedSections) {
    const rows = Array.isArray(sections[sectionKey]) ? sections[sectionKey] : [];

    rows.forEach((row, index) => {
      if (!row.playerId) return;

      const id = String(row.playerId);
      const existing = byPlayer.get(id) || {
        ...row,
        appearances: [],
        consensusScore: 0,
        consensusTags: []
      };

      const rankScore = Math.max(0, 12 - index);
      const sectionWeight =
        sectionKey === "topOverallPlays" ? 16 :
        sectionKey === "pickOnePool" ? 15 :
        sectionKey === "bestPointsPlays" ? 13 :
        sectionKey === "topRebounds" ? 10 :
        sectionKey === "topAssists" ? 10 :
        sectionKey === "topThrees" ? 10 :
        sectionKey === "safeFloor" ? 9 :
        sectionKey === "boomCandidates" ? 9 :
        8;

      existing.appearances.push({
        section: label,
        rank: index + 1
      });

      existing.consensusScore += rankScore + sectionWeight;
      existing.consensusTags.push(label);

      byPlayer.set(id, existing);
    });
  }

  return Array.from(byPlayer.values())
    .filter(row => row.appearances.length >= 2)
    .map(row => ({
      ...row,
      consensusScore: round1(row.consensusScore),
      consensusCount: row.appearances.length,
      consensusTags: [...new Set(row.consensusTags)],
      reason: `Appears in ${row.appearances.length} key Decision Center sections: ${row.appearances.map(a => `${a.section} #${a.rank}`).join(", ")}.`,
      tags: [...new Set([
        "Consensus Play",
        row.appearances.length >= 4 ? "Multi-Board Standout" : "",
        row.appearances.length >= 3 ? "Strong Cross-Market Profile" : "",
        ...(Array.isArray(row.tags) ? row.tags : [])
      ].filter(Boolean))].slice(0, 18)
    }))
    .sort((a, b) =>
      num(b.consensusScore) - num(a.consensusScore) ||
      num(b.consensusCount) - num(a.consensusCount) ||
      String(a.player).localeCompare(String(b.player))
    )
    .slice(0, 12)
    .map((row, index) => ({
      ...row,
      rank: index + 1
    }));
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
  sections.consensusPlays = buildConsensusSection(sections);

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
    availability: Number(points.gameCount || 0) > 0 ? "games_scheduled" : "no_games_scheduled",
    modelNotes: [
      "NBA Decision Center 2.0 is built from the NBA Points Board, NBA Matchup Engine, Rebounds Board, Assists Board, and Threes Board.",
      "Sections include top overall plays, I Can Only Pick One, position rankings, consensus plays, best points plays, usage risers, minutes monsters, scoring form, safe floor, boom candidates, defense targets, tough defense warnings, top rebounds, top assists, top threes, best matchups by position, and watch list.",
      "No odds or betting lines are used."
    ],
    sections
  };

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
