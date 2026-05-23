import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const WEBSITE_DATA = path.join(ROOT, "website/data");

function readJSON(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function toArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.stacks)) return payload.stacks;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.teams)) return payload.teams;
  return [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(value = "") {
  return String(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function label(score) {
  if (score >= 90) return "EXPLOSION IMMINENT";
  if (score >= 75) return "RAPID FIRE RISK";
  if (score >= 60) return "CHAIN ACTIVE";
  if (score >= 45) return "BUILDING PRESSURE";
  return "CALM";
}

function color(score) {
  if (score >= 90) return "RED";
  if (score >= 75) return "ORANGE";
  if (score >= 55) return "YELLOW";
  return "GREEN";
}

console.log("HR CHAIN REACTION ENGINE");
console.log("========================");

const liveStatePayload = readJSON(
  path.join(WEBSITE_DATA, "live_game_state.json"),
  {}
);

const bullpenPayload = readJSON(
  path.join(WEBSITE_DATA, "bullpen_collapse_engine.json"),
  []
);

const stackPayload = readJSON(
  path.join(WEBSITE_DATA, "team_stack_intelligence_2.json"),
  {}
);

const hrPayload = readJSON(
  path.join(WEBSITE_DATA, "mlb_home_runs.json"),
  []
);

const liveGames = toArray(liveStatePayload);
const bullpenRows = toArray(bullpenPayload);
const stackRows = toArray(stackPayload);
const hrRows = toArray(hrPayload);

const bullpenMap = {};

for (const row of bullpenRows) {
  bullpenMap[
    normalize(row.team || row.Team)
  ] = row;
}

const stackMap = {};

for (const row of stackRows) {
  stackMap[
    normalize(row.team || row.Team)
  ] = row;
}

const hrMap = {};

for (const row of hrRows) {
  const team =
    normalize(
      row.team ||
      row.Team ||
      row.playerTeam ||
      ""
    );

  if (!team) continue;

  if (!hrMap[team]) {
    hrMap[team] = [];
  }

  hrMap[team].push(row);
}

const output = [];

for (const game of liveGames) {
  const homeKey =
    normalize(game.homeTeam);

  const awayKey =
    normalize(game.awayTeam);

  const homeBullpen =
    bullpenMap[homeKey] || {};

  const awayBullpen =
    bullpenMap[awayKey] || {};

  const homeStack =
    stackMap[homeKey] || {};

  const awayStack =
    stackMap[awayKey] || {};

  const homeHrThreats =
    (hrMap[homeKey] || []).length;

  const awayHrThreats =
    (hrMap[awayKey] || []).length;

  const leverageScore =
    num(game.leverageScore);

  const hrEnvironmentScore =
    num(game.hrEnvironmentScore);

  const bullpenStressMultiplier =
    clamp(
      (
        num(homeBullpen.dangerScore) * 0.5 +
        num(awayBullpen.dangerScore) * 0.5
      ),
      0,
      100
    );

  const pitcherTiltFactor =
    clamp(
      (
        leverageScore * 0.4 +
        bullpenStressMultiplier * 0.35 +
        hrEnvironmentScore * 0.25
      ),
      0,
      100
    );

  const rapidFireHrProbability =
    clamp(
      (
        hrEnvironmentScore * 0.4 +
        leverageScore * 0.3 +
        (
          (homeHrThreats + awayHrThreats) * 4
        )
      ),
      0,
      100
    );

  const inningExplosionRisk =
    clamp(
      (
        rapidFireHrProbability * 0.45 +
        pitcherTiltFactor * 0.35 +
        bullpenStressMultiplier * 0.2
      ),
      0,
      100
    );

  const stackEscalationScore =
    clamp(
      (
        num(homeStack.enhancedStackScore) * 0.5 +
        num(awayStack.enhancedStackScore) * 0.5 +
        inningExplosionRisk * 0.3
      ),
      0,
      100
    );

  const comebackVolatility =
    clamp(
      (
        leverageScore * 0.5 +
        bullpenStressMultiplier * 0.3 +
        rapidFireHrProbability * 0.2
      ),
      0,
      100
    );

  const crowdMomentumRating =
    clamp(
      (
        inningExplosionRisk * 0.55 +
        stackEscalationScore * 0.45
      ),
      0,
      100
    );

  const chainReactionScore =
    clamp(
      (
        inningExplosionRisk * 0.35 +
        rapidFireHrProbability * 0.25 +
        pitcherTiltFactor * 0.2 +
        stackEscalationScore * 0.2
      ),
      0,
      100
    );

  output.push({
    game: game.game,

    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,

    chainReactionScore:
      Number(chainReactionScore.toFixed(1)),

    inningExplosionRisk:
      Number(inningExplosionRisk.toFixed(1)),

    rapidFireHrProbability:
      Number(
        rapidFireHrProbability.toFixed(1)
      ),

    pitcherTiltFactor:
      Number(
        pitcherTiltFactor.toFixed(1)
      ),

    bullpenStressMultiplier:
      Number(
        bullpenStressMultiplier.toFixed(1)
      ),

    stackEscalationScore:
      Number(
        stackEscalationScore.toFixed(1)
      ),

    comebackVolatility:
      Number(
        comebackVolatility.toFixed(1)
      ),

    crowdMomentumRating:
      Number(
        crowdMomentumRating.toFixed(1)
      ),

    leverageScore,

    hrEnvironmentScore,

    chainReactionLabel:
      label(chainReactionScore),

    visualHeatLevel:
      color(chainReactionScore),

    liveAlert:
      chainReactionScore >= 85
        ? "MULTI HR INNING WATCH"
        : chainReactionScore >= 70
        ? "CHAIN REACTION ACTIVE"
        : chainReactionScore >= 55
        ? "HR PRESSURE BUILDING"
        : "NORMAL"
  });
}

output.sort(
  (a, b) =>
    num(b.chainReactionScore) -
    num(a.chainReactionScore)
);

fs.writeFileSync(
  path.join(
    WEBSITE_DATA,
    "hr_chain_reaction.json"
  ),
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      count: output.length,
      games: output
    },
    null,
    2
  )
);

console.log("");
console.log("HR CHAIN REACTION ENGINE COMPLETE");
console.log(`Games: ${output.length}`);

console.table(
  output.slice(0, 10).map(game => ({
    game: game.game,
    chain: game.chainReactionScore,
    label: game.chainReactionLabel,
    alert: game.liveAlert
  }))
);

console.log("");
console.log(
  `Saved: ${path.join(
    WEBSITE_DATA,
    "hr_chain_reaction.json"
  )}`
);
