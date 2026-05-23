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
  if (Array.isArray(payload.players)) return payload.players;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.hitters)) return payload.hitters;
  if (Array.isArray(payload.games)) return payload.games;
  return [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function norm(value = "") {
  return String(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function grade(score) {
  if (score >= 90) return "NUCLEAR";
  if (score >= 80) return "ELITE";
  if (score >= 70) return "STRONG";
  if (score >= 60) return "LIVE";
  if (score >= 50) return "WATCH";
  return "QUIET";
}

function pitcherStress(pitcher = {}) {
  const era = num(pitcher.era);
  const whip = num(pitcher.whip);
  const hr = num(pitcher.homeRuns);
  const ip = num(pitcher.inningsPitched);

  const hr9 = ip > 0 ? (hr / ip) * 9 : 0;

  return clamp(
    era * 6 +
      whip * 14 +
      hr9 * 14,
    0,
    100
  );
}

function powerScore(hitter = {}, base = 0) {
  const hr = num(hitter.hr);
  const slg = num(hitter.slg);
  const ops = num(hitter.ops);
  const rbi = num(hitter.rbi);

  return clamp(
    base * 0.45 +
      hr * 1.4 +
      slg * 45 +
      ops * 25 +
      rbi * 0.35,
    0,
    100
  );
}

function contactScore(hitter = {}, base = 0) {
  const hits = num(hitter.hits);
  const avg = num(hitter.avg);
  const obp = num(hitter.obp);
  const strikeOuts = num(hitter.strikeOuts);
  const pa = num(hitter.plateAppearances);

  const kRate = pa > 0 ? strikeOuts / pa : 0;

  return clamp(
    base * 0.35 +
      hits * 0.45 +
      avg * 80 +
      obp * 70 -
      kRate * 20,
    0,
    100
  );
}

function tbScoreFromStats(hitter = {}, base = 0) {
  const doubles = num(hitter.doubles);
  const triples = num(hitter.triples);
  const hr = num(hitter.hr);
  const slg = num(hitter.slg);
  const ops = num(hitter.ops);

  return clamp(
    base * 0.45 +
      doubles * 0.9 +
      triples * 1.1 +
      hr * 1.7 +
      slg * 40 +
      ops * 18,
    0,
    100
  );
}

console.log("ADVANCED PLAYER INTELLIGENCE");
console.log("============================");

const playerPool = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_player_pool.json"), [])
);

const hrRows = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_home_runs.json"), [])
);

const hitsRows = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_hits.json"), [])
);

const tbRows = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_total_bases.json"), [])
);

const players = new Map();

function seed(row) {
  const player = row.player || row.name || row.Player || "";
  if (!player) return;

  const key = norm(player);

  if (!players.has(key)) {
    players.set(key, {
      player,
      playerId: row.playerId || "",
      team: row.team || row.Team || "",
      opponent: row.opponent || row.Opponent || "",
      game: row.game || "",
      venue: row.venue || "",
      pitcher:
        row.opposingPitcher ||
        row.opposingProbablePitcher ||
        row.pitcher ||
        ""
    });
  }

  const existing = players.get(key);

  existing.playerId = existing.playerId || row.playerId || "";
  existing.team = existing.team || row.team || row.Team || "";
  existing.opponent = existing.opponent || row.opponent || row.Opponent || "";
  existing.game = existing.game || row.game || "";
  existing.venue = existing.venue || row.venue || "";
  existing.pitcher =
    existing.pitcher ||
    row.opposingPitcher ||
    row.opposingProbablePitcher ||
    row.pitcher ||
    "";
}

for (const row of playerPool) seed(row);
for (const row of hrRows) seed(row);
for (const row of hitsRows) seed(row);
for (const row of tbRows) seed(row);

const hrMap = {};
for (const row of hrRows) {
  const key = norm(row.player);
  if (key) hrMap[key] = row;
}

const hitMap = {};
for (const row of hitsRows) {
  const key = norm(row.player);
  if (key) hitMap[key] = row;
}

const tbMap = {};
for (const row of tbRows) {
  const key = norm(row.player);
  if (key) tbMap[key] = row;
}

const output = [];

for (const [key, base] of players.entries()) {
  const hr = hrMap[key] || {};
  const hit = hitMap[key] || {};
  const tb = tbMap[key] || {};

  const hrBase = num(hr.score);
  const hitBase = num(hit.score);
  const tbBase = num(tb.score);

  const hrHitter = hr.stats?.hitter || {};
  const hitHitter = hit.stats?.hitter || {};
  const pitcher =
    hr.stats?.pitcher ||
    hit.stats?.pitcher ||
    {};

  const pitcherRiskScore = pitcherStress(pitcher);

  const calculatedPower = powerScore(hrHitter, hrBase);
  const calculatedContact = contactScore(hitHitter, hitBase);
  const calculatedTb = tbBase || tbScoreFromStats(hrHitter, 0);

  const fallbackPoolScore =
    calculatedPower ||
    calculatedContact ||
    calculatedTb ||
    42;

  const powerFormScore = clamp(
    calculatedPower ||
      fallbackPoolScore,
    0,
    100
  );

  const contactFloorScore = clamp(
    calculatedContact ||
      fallbackPoolScore * 0.8,
    0,
    100
  );

  const matchupIntelligenceScore = clamp(
    pitcherRiskScore * 0.45 +
      powerFormScore * 0.35 +
      calculatedTb * 0.2,
    0,
    100
  );

  const overallPlayerScore = clamp(
    powerFormScore * 0.38 +
      contactFloorScore * 0.27 +
      matchupIntelligenceScore * 0.35,
    0,
    100
  );

  const hitterStats = Object.keys(hrHitter).length ? hrHitter : hitHitter;

  const tags = [];

  if (powerFormScore >= 75) tags.push("POWER FORM");
  if (contactFloorScore >= 75) tags.push("CONTACT FLOOR");
  if (matchupIntelligenceScore >= 75) tags.push("MATCHUP EDGE");
  if (num(hitterStats.ops) >= 0.9) tags.push("OPS HEATER");
  if (num(hitterStats.slg) >= 0.5) tags.push("SLG THREAT");
  if (pitcherRiskScore >= 60) tags.push("PITCHER TARGET");
  if (!tags.length) tags.push("PROFILE WATCH");

  output.push({
    player: base.player,
    playerId: base.playerId,
    team: base.team,
    opponent: base.opponent,
    game: base.game,
    venue: base.venue,
    pitcher: base.pitcher,

    overallPlayerScore: Number(overallPlayerScore.toFixed(1)),
    grade: grade(overallPlayerScore),

    powerFormScore: Number(powerFormScore.toFixed(1)),
    contactFloorScore: Number(contactFloorScore.toFixed(1)),
    matchupIntelligenceScore: Number(matchupIntelligenceScore.toFixed(1)),

    hrScore: Number((hrBase || calculatedPower).toFixed(1)),
    hitScore: Number((hitBase || calculatedContact).toFixed(1)),
    tbScore: Number(calculatedTb.toFixed(1)),

    pitchDamageScore: Number(pitcherRiskScore.toFixed(1)),
    zoneScore: Number(((powerFormScore + matchupIntelligenceScore) / 2).toFixed(1)),
    handednessScore: 50,

    hitterStats,
    pitcherStats: pitcher,

    bestPitchMatchup:
      pitcherRiskScore >= 60
        ? "PITCHER DAMAGE PROFILE"
        : "STANDARD MATCHUP",

    profileTags: tags,

    notes: [
      hr.note || "",
      hit.note || "",
      tb.note || ""
    ].filter(Boolean)
  });
}

output.sort((a, b) => num(b.overallPlayerScore) - num(a.overallPlayerScore));

fs.writeFileSync(
  path.join(WEBSITE_DATA, "advanced_player_intelligence.json"),
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      count: output.length,
      players: output
    },
    null,
    2
  )
);

console.log("");
console.log("ADVANCED PLAYER INTELLIGENCE COMPLETE");
console.log(`Players: ${output.length}`);

console.table(
  output.slice(0, 20).map(row => ({
    player: row.player,
    team: row.team,
    score: row.overallPlayerScore,
    grade: row.grade,
    tags: row.profileTags.join(", ")
  }))
);

console.log("");
console.log(`Saved: ${path.join(WEBSITE_DATA, "advanced_player_intelligence.json")}`);
