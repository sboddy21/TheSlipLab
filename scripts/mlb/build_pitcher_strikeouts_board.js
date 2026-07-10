import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const GAMES_FILE = path.join(ROOT, "website", "data", "game_pitcher_matchups.json");
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_pitcher_strikeouts.json");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return payload.matchups || payload.games || payload.players || payload.rows || payload.data || [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inningsToNumber(value) {
  if (typeof value === "number") return value;
  if (value === undefined || value === null || value === "") return 0;

  const str = String(value);
  if (!str.includes(".")) return num(str);

  const [whole, frac] = str.split(".");
  return num(whole) + num(frac) / 3;
}

function pitcherFrom(game, side) {
  const isAway = side === "away";
  const p = isAway ? game.awayPitcher : game.homePitcher;

  return {
    pitcherId: p?.id || p?.playerId || p?.pitcherId || (isAway ? game.awayProbablePitcherId : game.homeProbablePitcherId),
    pitcher: p?.name || p?.pitcher || (isAway ? game.awayProbablePitcher : game.homeProbablePitcher),
    team: isAway ? game.awayTeam : game.homeTeam,
    opponent: isAway ? game.homeTeam : game.awayTeam,
    game: game.matchup || `${game.awayTeam || ""} at ${game.homeTeam || ""}`.trim(),
    side,
    gamePk: game.gamePk,
    venue: game.venue,
    lineupLockStatus: game.lineupLockStatus,
    stats: p?.stats || {},
    vulnerability: num(p?.vulnerability)
  };
}

function pitcherProfile(row) {
  const s = row.stats || {};
  const innings = inningsToNumber(s.inningsPitched);
  const strikeOuts = num(s.strikeOuts);
  const walks = num(s.walks ?? s.baseOnBalls);
  const hits = num(s.hits);
  const homeRuns = num(s.homeRuns);
  const era = num(s.era);
  const whip = num(s.whip);

  const estimatedStarts =
    innings >= 120 ? 22 :
    innings >= 95 ? 18 :
    innings >= 70 ? 14 :
    innings >= 45 ? 9 :
    innings >= 25 ? 5 :
    1;

  const expectedInnings = clamp(innings / estimatedStarts, 3.8, 6.7);

  return {
    era,
    whip,
    hits,
    homeRuns,
    inningsPitched: Number(innings.toFixed(1)),
    strikeOuts,
    walks,
    estimatedStarts,
    expectedInnings,
    kPer9: innings > 0 ? Number(((strikeOuts / innings) * 9).toFixed(2)) : 0,
    bbPer9: innings > 0 ? Number(((walks / innings) * 9).toFixed(2)) : 0,
    hPer9: innings > 0 ? Number(((hits / innings) * 9).toFixed(2)) : 0,
    hrPer9: innings > 0 ? Number(((homeRuns / innings) * 9).toFixed(2)) : 0
  };
}

function opponentProfile(game, side) {
  const hitters = side === "away" ? game.hitters?.home || [] : game.hitters?.away || [];
  const confirmed = hitters.filter(h => h.confirmedLineup).length;
  const lineupSpots = hitters.filter(h => h.lineupSpot).length;

  const ordered = hitters.slice().sort((a, b) => num(a.lineupSpot, 99) - num(b.lineupSpot, 99));
  const sampled = ordered.slice(0, 9);

  let totalKs = 0;
  let totalPA = 0;
  let highKHitters = 0;
  let lowKHitters = 0;

  for (const h of sampled) {
    const s = h.stats?.hitter || h.hitterStats || {};
    const strikeOuts = num(s.strikeOuts ?? h.strikeOuts);
    const pa = num(s.plateAppearances ?? h.plateAppearances);
    const rate = pa > 0 ? strikeOuts / pa : 0;

    totalKs += strikeOuts;
    totalPA += pa;

    if (rate >= 0.25) highKHitters++;
    if (rate > 0 && rate <= 0.17) lowKHitters++;
  }

  const kRate = totalPA > 0 ? totalKs / totalPA : 0;

  return {
    hitters: hitters.length,
    sampled: sampled.length,
    confirmed,
    lineupSpots,
    lineupQuality:
      confirmed >= 9 ? "CONFIRMED" :
      lineupSpots >= 9 ? "PROJECTED_ORDER" :
      "PROJECTED",
    totalKs,
    totalPA,
    avgStrikeOuts: sampled.length ? Number((totalKs / sampled.length).toFixed(1)) : 0,
    kRate: Number(kRate.toFixed(3)),
    highKHitters,
    lowKHitters
  };
}

function projectionEngine(pitcher, opponent) {
  const rawBase = (pitcher.kPer9 / 9) * pitcher.expectedInnings;

  const opponentKAdjustment = clamp((opponent.kRate - 0.205) * 13.5, -0.75, 1.05);
  const highKAdjustment = clamp((opponent.highKHitters - 3) * 0.16, -0.35, 0.65);
  const lowKAdjustment = clamp((opponent.lowKHitters - 2) * -0.12, -0.45, 0.25);
  const commandDrag = clamp((pitcher.bbPer9 - 3.2) * 0.10, 0, 0.45);
  const workloadDrag = pitcher.inningsPitched < 35 ? 0.45 : pitcher.inningsPitched < 60 ? 0.20 : 0;

  const projection = clamp(
    rawBase + opponentKAdjustment + highKAdjustment + lowKAdjustment - commandDrag - workloadDrag,
    2.5,
    10.5
  );

  return {
    rawBase: Number(rawBase.toFixed(2)),
    opponentKAdjustment: Number(opponentKAdjustment.toFixed(2)),
    highKAdjustment: Number(highKAdjustment.toFixed(2)),
    lowKAdjustment: Number(lowKAdjustment.toFixed(2)),
    commandDrag: Number(commandDrag.toFixed(2)),
    workloadDrag: Number(workloadDrag.toFixed(2)),
    projectedStrikeouts: Number(projection.toFixed(1))
  };
}

function confidenceEngine(pitcher, opponent, projection, row) {
  let confidence = 42;

  confidence += clamp((projection.projectedStrikeouts - 4.5) * 6.5, -8, 22);
  confidence += clamp((pitcher.kPer9 - 7.5) * 2.8, -7, 15);
  confidence += clamp((opponent.kRate - 0.20) * 85, -7, 8);
  confidence += clamp((opponent.highKHitters - 2) * 2.0, -4, 8);
  confidence += clamp((pitcher.expectedInnings - 5.2) * 4.0, -6, 6);

  if (opponent.lineupQuality === "CONFIRMED") confidence += 4;
  else if (opponent.lineupQuality === "PROJECTED_ORDER") confidence += 1;
  else confidence -= 5;

  if (pitcher.inningsPitched < 30) confidence -= 9;
  else if (pitcher.inningsPitched < 60) confidence -= 4;

  if (pitcher.bbPer9 >= 4.2) confidence -= 6;
  else if (pitcher.bbPer9 >= 3.6) confidence -= 3;

  if (pitcher.whip >= 1.45) confidence -= 5;
  else if (pitcher.whip >= 1.32) confidence -= 2;

  if (row.vulnerability >= 65) confidence -= 4;
  else if (row.vulnerability >= 50) confidence -= 2;

  return Math.round(clamp(confidence, 20, 92));
}

function edge(score, projection) {
  if (score >= 82 && projection >= 7.2) return "Elite";
  if (score >= 69 && projection >= 6.2) return "Strong";
  if (score >= 61 && projection >= 5.5) return "Value";
  if (score >= 50 && projection >= 4.7) return "Watch";
  return "Thin";
}

function note(pitcher, opponent, projection) {
  const oppPct = opponent.kRate ? `${Math.round(opponent.kRate * 1000) / 10}%` : "--";
  return [
    `Projected Ks ${projection.projectedStrikeouts}`,
    `K/9 ${pitcher.kPer9 || "--"}`,
    `Opponent K% ${oppPct}`,
    `${opponent.highKHitters} high-K bats`,
    opponent.lineupQuality
  ].join(" • ");
}

function main() {
  const games = rows(readJson(GAMES_FILE, []));
  const seen = new Set();
  const output = [];

  for (const game of games) {
    for (const side of ["away", "home"]) {
      const row = pitcherFrom(game, side);
      if (!row.pitcherId || !row.pitcher || row.pitcher === "TBD") continue;

      const key = String(row.pitcherId);
      if (seen.has(key)) continue;
      seen.add(key);

      const pitcher = pitcherProfile(row);
      const opponent = opponentProfile(game, side);
      const projection = projectionEngine(pitcher, opponent);
      const score = confidenceEngine(pitcher, opponent, projection, row);

      output.push({
        rank: 0,
        player: row.pitcher,
        playerId: row.pitcherId,
        pitcher: row.pitcher,
        pitcherId: row.pitcherId,
        team: row.team,
        opponent: row.opponent,
        game: row.game,
        gamePk: row.gamePk,
        venue: row.venue,
        lineupStatus: opponent.lineupQuality,
        score,
        projection: projection.projectedStrikeouts,
        projectedStrikeouts: projection.projectedStrikeouts,
        seasonTotal: pitcher.strikeOuts,
        marketStatLabel: "Projected Ks",
        marketStatValue: projection.projectedStrikeouts,
        odds: "N/A",
        edge: edge(score, projection.projectedStrikeouts),
        note: note(pitcher, opponent, projection),
        stats: {
          pitcher,
          opponent,
          projection
        }
      });
    }
  }

  output.sort((a, b) =>
    b.score - a.score ||
    b.projectedStrikeouts - a.projectedStrikeouts ||
    b.stats.pitcher.kPer9 - a.stats.pitcher.kPer9
  );

  const finalRows = output.slice(0, 40).map((row, index) => ({
    ...row,
    rank: index + 1
  }));

  fs.writeFileSync(OUT_FILE, JSON.stringify(finalRows, null, 2));

  console.log("Pitcher strikeouts board saved");
  console.log("Players:", finalRows.length);
  console.log("Top:", finalRows.slice(0, 8).map(r => `${r.rank}. ${r.player} ${r.projectedStrikeouts} Ks ${r.score} ${r.edge}`).join(" | "));
}

main();
