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
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
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

function impactLabel(score) {
  if (score >= 90) return "GAME BREAKING";
  if (score >= 75) return "CHAIN REACTION";
  if (score >= 60) return "MOMENTUM SHIFT";
  if (score >= 45) return "PRESSURE BUILD";
  return "NORMAL";
}

console.log("LIVE HR TRACKER");
console.log("================");

const chainPayload = readJSON(
  path.join(WEBSITE_DATA, "hr_chain_reaction.json"),
  {}
);

const livePayload = readJSON(
  path.join(WEBSITE_DATA, "live_game_state.json"),
  {}
);

const chainGames = toArray(chainPayload);
const liveGames = toArray(livePayload);

const output = [];

for (const game of chainGames) {
  const leverageScore =
    num(game.leverageScore);

  const chainReactionScore =
    num(game.chainReactionScore);

  const explosionRisk =
    num(game.inningExplosionRisk);

  const rapidFireRisk =
    num(game.rapidFireHrProbability);

  const momentum =
    num(game.crowdMomentumRating);

  const simulatedEvents = [];

  const eventCount =
    Math.max(
      2,
      Math.round(chainReactionScore / 20)
    );

  for (let i = 0; i < eventCount; i++) {
    const inning =
      Math.min(
        9,
        Math.max(
          1,
          Math.round(
            (i + 1) *
            (9 / eventCount)
          )
        )
      );

    const impactScore =
      clamp(
        (
          chainReactionScore * 0.4 +
          explosionRisk * 0.3 +
          rapidFireRisk * 0.2 +
          momentum * 0.1 +
          Math.random() * 12
        ),
        0,
        100
      );

    simulatedEvents.push({
      inning,
      eventType:
        impactScore >= 80
          ? "HOME RUN"
          : impactScore >= 60
          ? "EXTRA BASE HIT"
          : "PRESSURE EVENT",

      impactScore:
        Number(impactScore.toFixed(1)),

      impactLabel:
        impactLabel(impactScore),

      leverageShift:
        Number(
          clamp(
            leverageScore +
            impactScore * 0.12,
            0,
            100
          ).toFixed(1)
        ),

      chainBoost:
        Number(
          clamp(
            chainReactionScore +
            impactScore * 0.15,
            0,
            100
          ).toFixed(1)
        ),

      momentumSpike:
        Number(
          clamp(
            momentum +
            impactScore * 0.2,
            0,
            100
          ).toFixed(1)
        )
    });
  }

  output.push({
    game: game.game,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,

    leverageScore,
    chainReactionScore,
    inningExplosionRisk: explosionRisk,
    rapidFireHrProbability: rapidFireRisk,

    liveVolatility:
      Number(
        clamp(
          (
            leverageScore * 0.4 +
            chainReactionScore * 0.35 +
            explosionRisk * 0.25
          ),
          0,
          100
        ).toFixed(1)
      ),

    timeline: simulatedEvents
  });
}

output.sort(
  (a, b) =>
    num(b.liveVolatility) -
    num(a.liveVolatility)
);

fs.writeFileSync(
  path.join(
    WEBSITE_DATA,
    "live_hr_tracker.json"
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
console.log("LIVE HR TRACKER COMPLETE");
console.log(`Games: ${output.length}`);

console.table(
  output.slice(0, 10).map(game => ({
    game: game.game,
    volatility: game.liveVolatility,
    chain: game.chainReactionScore
  }))
);

console.log("");
console.log(
  `Saved: ${path.join(
    WEBSITE_DATA,
    "live_hr_tracker.json"
  )}`
);
