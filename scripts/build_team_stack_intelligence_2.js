import fs from "fs";
import path from "path";

const ROOT = path.resolve();
const WEBSITE_DATA = path.join(ROOT, "website", "data");
const EXPORTS_DIR = path.join(ROOT, "exports");

const FILES = {
  homeRuns: path.join(WEBSITE_DATA, "mlb_home_runs.json"),
  teamStacks: path.join(WEBSITE_DATA, "mlb_team_stacks.json"),
  weather: path.join(WEBSITE_DATA, "mlb_weather.json"),
  pitcherZones: path.join(WEBSITE_DATA, "pitcher_attack_zones.json"),
  playerPool: path.join(WEBSITE_DATA, "mlb_player_pool.json")
};

const OUTPUTS = {
  stackIntel: path.join(WEBSITE_DATA, "team_stack_intelligence_2.json"),
  leverage: path.join(WEBSITE_DATA, "stack_leverage_profiles.json"),
  collapse: path.join(WEBSITE_DATA, "collapse_alerts.json"),
  csv: path.join(EXPORTS_DIR, "team_stack_intelligence_2.csv")
};

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function avg(values) {
  const nums = values.map(v => num(v)).filter(v => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(file, rows) {
  if (!rows.length) {
    fs.writeFileSync(file, "");
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))
  ];

  fs.writeFileSync(file, lines.join("\n"));
}

function combos(items, size) {
  const out = [];

  function walk(start, combo) {
    if (combo.length === size) {
      out.push([...combo]);
      return;
    }

    for (let i = start; i < items.length; i++) {
      combo.push(items[i]);
      walk(i + 1, combo);
      combo.pop();
    }
  }

  walk(0, []);
  return out;
}

function getWeather(weatherRows, venue) {
  return weatherRows.find(w => clean(w.venue).toLowerCase() === clean(venue).toLowerCase()) || {};
}

function getZoneProfile(zonePlayers, player) {
  return zonePlayers[clean(player)] || {};
}

function topZones(zoneProfile) {
  const zones = zoneProfile?.zones?.zones || [];
  return zones
    .slice()
    .sort((a, b) => num(b.danger) - num(a.danger))
    .slice(0, 5)
    .map(z => `${z.zone}:${z.danger}`)
    .join(" | ");
}

function redZoneCount(zoneProfile) {
  const zones = zoneProfile?.zones?.zones || [];
  return zones.filter(z => clean(z.attack).toLowerCase() === "red").length;
}

function stackGrade(score) {
  if (score >= 90) return "NUKE STACK";
  if (score >= 80) return "ELITE STACK";
  if (score >= 70) return "ATTACK STACK";
  if (score >= 60) return "LIVE STACK";
  if (score >= 50) return "WATCH STACK";
  return "THIN STACK";
}

function volatilityLabel(score) {
  if (score >= 90) return "NUCLEAR";
  if (score >= 78) return "CHAOTIC";
  if (score >= 66) return "AGGRESSIVE";
  if (score >= 54) return "STABLE";
  return "SAFE";
}

function leverageLabel(score) {
  if (score >= 85) return "ELITE LEVERAGE";
  if (score >= 72) return "STRONG LEVERAGE";
  if (score >= 60) return "SOLID LEVERAGE";
  if (score >= 48) return "LIGHT LEVERAGE";
  return "CHALKY";
}

function collapseLabel(score) {
  if (score >= 85) return "RED ALERT";
  if (score >= 72) return "HIGH RISK";
  if (score >= 60) return "PRESSURE SPOT";
  if (score >= 48) return "WATCH";
  return "LOW";
}

function pitcherCollapseFromStack(stack) {
  const factors = Array.isArray(stack.factors) ? stack.factors.join(" ") : "";
  const eraMatch = factors.match(/ERA leak at ([0-9.]+)/i);
  const whipMatch = factors.match(/WHIP/i);
  const hrMatch = factors.match(/([0-9]+) HR allowed/i);

  const era = eraMatch ? num(eraMatch[1]) : 4.2;
  const hrAllowed = hrMatch ? num(hrMatch[1]) : 4;
  const whipBoost = whipMatch ? 12 : 0;

  return clamp(Math.round((era * 9) + (hrAllowed * 3.5) + whipBoost), 1, 99);
}

function weatherBoost(weather, stack) {
  const wind = num(weather.windSpeed ?? stack.windSpeed);
  const temp = num(weather.temp ?? stack.temp);

  let score = 0;

  if (wind >= 12) score += 14;
  else if (wind >= 8) score += 9;
  else if (wind >= 5) score += 5;

  if (temp >= 80) score += 8;
  else if (temp >= 70) score += 5;
  else if (temp <= 50 && temp > 0) score -= 4;

  return clamp(score, -10, 20);
}

function dedupeHitters(hitters) {
  const map = new Map();

  for (const h of hitters || []) {
    const name = clean(h.player);
    if (!name) continue;

    const current = map.get(name);
    if (!current || num(h.score) > num(current.score)) {
      map.set(name, h);
    }
  }

  return [...map.values()];
}

console.log("");
console.log("TEAM STACK INTELLIGENCE 2.0");
console.log("");

const homeRunsRaw = readJson(FILES.homeRuns, []);
const teamStacksRaw = readJson(FILES.teamStacks, { stacks: [] });
const weatherRaw = readJson(FILES.weather, { weather: [] });
const pitcherZonesRaw = readJson(FILES.pitcherZones, { players: {} });
const playerPoolRaw = readJson(FILES.playerPool, { players: [] });

const homeRuns = Array.isArray(homeRunsRaw) ? homeRunsRaw : [];
const teamStacks = Array.isArray(teamStacksRaw?.stacks) ? teamStacksRaw.stacks : [];
const weatherRows = Array.isArray(weatherRaw?.weather) ? weatherRaw.weather : [];
const zonePlayers = pitcherZonesRaw?.players || {};
const playerPool = Array.isArray(playerPoolRaw?.players) ? playerPoolRaw.players : [];

const playerPoolByName = new Map(playerPool.map(p => [clean(p.player), p]));

const stackRows = [];
const leverageRows = [];
const collapseRows = [];

for (const stack of teamStacks) {
  const hitters = dedupeHitters(stack.hitters)
    .map(h => {
      const pool = playerPoolByName.get(clean(h.player)) || {};
      const zoneProfile = getZoneProfile(zonePlayers, h.player);
      const redZones = redZoneCount(zoneProfile);
      const zonePower = num(zoneProfile?.zones?.hitterPower);
      const pitcherLeak = num(zoneProfile?.zones?.pitcherLeak);

      return {
        player: clean(h.player),
        batSide: clean(h.batSide || zoneProfile?.zones?.side),
        score: num(h.score),
        hr: num(h.hr),
        slg: num(h.slg),
        ops: num(h.ops),
        edge: clean(h.edge),
        note: clean(h.note),
        position: clean(pool.position),
        playerId: pool.playerId || null,
        redZones,
        zonePower,
        pitcherLeak,
        topZones: topZones(zoneProfile)
      };
    })
    .filter(h => h.player && h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);

  if (hitters.length < 2) continue;

  const weather = getWeather(weatherRows, stack.venue);
  const pCollapse = pitcherCollapseFromStack(stack);
  const wBoost = weatherBoost(weather, stack);
  const parkBoost = num(stack.parkFactor) ? clamp((num(stack.parkFactor) - 100) * 0.7, -8, 12) : 0;
  const baseStackScore = num(stack.stackScore);
  const bullpenCollapse = clamp(Math.round((pCollapse * 0.55) + (baseStackScore * 0.25) + (wBoost * 1.4)), 1, 99);

  collapseRows.push({
    team: clean(stack.team),
    opponent: clean(stack.opponent),
    game: clean(stack.game),
    venue: clean(stack.venue),
    opposingPitcher: clean(stack.opposingPitcher),
    pitcherCollapseProbability: pCollapse,
    bullpenCollapseScore: bullpenCollapse,
    collapseLabel: collapseLabel(Math.max(pCollapse, bullpenCollapse)),
    stackScore: baseStackScore,
    weatherBoost: wBoost,
    parkBoost: Number(parkBoost.toFixed(2)),
    factors: Array.isArray(stack.factors) ? stack.factors.join(" | ") : ""
  });

  for (const size of [2, 3, 4]) {
    if (hitters.length < size) continue;

    for (const group of combos(hitters, size)) {
      const avgScore = avg(group.map(h => h.score));
      const avgOps = avg(group.map(h => h.ops));
      const avgSlg = avg(group.map(h => h.slg));
      const totalHr = group.reduce((sum, h) => sum + num(h.hr), 0);
      const redZones = group.reduce((sum, h) => sum + num(h.redZones), 0);
      const avgLeak = avg(group.map(h => h.pitcherLeak));
      const sameSide = group.every(h => h.batSide && h.batSide === group[0].batSide);
      const sideBonus = sameSide ? 8 : 2;

      const correlationScore = clamp(Math.round(
        avgScore * 0.42 +
        pCollapse * 0.18 +
        bullpenCollapse * 0.13 +
        redZones * 1.5 +
        sideBonus +
        wBoost +
        parkBoost
      ), 1, 99);

      const leverageScore = clamp(Math.round(
        correlationScore * 0.46 +
        avgLeak * 0.18 +
        avgScore * 0.2 +
        size * 3 +
        (100 - baseStackScore) * 0.04
      ), 1, 99);

      const volatilityScore = clamp(Math.round(
        correlationScore * 0.35 +
        totalHr * 1.2 +
        pCollapse * 0.18 +
        bullpenCollapse * 0.16 +
        size * 5
      ), 1, 99);

      const chainReactionProbability = clamp(Math.round(
        correlationScore * 0.38 +
        pCollapse * 0.23 +
        bullpenCollapse * 0.19 +
        wBoost * 1.1 +
        parkBoost * 1.3 +
        size * 3
      ), 1, 99);

      const finalScore = clamp(Math.round(
        correlationScore * 0.32 +
        leverageScore * 0.22 +
        volatilityScore * 0.18 +
        chainReactionProbability * 0.28
      ), 1, 99);

      const row = {
        updatedAt: new Date().toISOString(),
        team: clean(stack.team),
        opponent: clean(stack.opponent),
        game: clean(stack.game),
        venue: clean(stack.venue),
        opposingPitcher: clean(stack.opposingPitcher),
        stackSize: size,
        players: group.map(h => h.player).join(" | "),
        batSides: group.map(h => h.batSide || "U").join(" | "),
        avgHrScore: Number(avgScore.toFixed(2)),
        avgOps: Number(avgOps.toFixed(3)),
        avgSlg: Number(avgSlg.toFixed(3)),
        totalSeasonHr: totalHr,
        redAttackZones: redZones,
        pitcherCollapseProbability: pCollapse,
        bullpenCollapseScore: bullpenCollapse,
        weatherBoost: wBoost,
        parkBoost: Number(parkBoost.toFixed(2)),
        correlationScore,
        leverageScore,
        leverageProfile: leverageLabel(leverageScore),
        volatilityScore,
        volatilityMeter: volatilityLabel(volatilityScore),
        hrChainReactionProbability: chainReactionProbability,
        finalStackScore: finalScore,
        stackGrade: stackGrade(finalScore),
        correlatedHrLane: sameSide ? "SAME SIDE POWER LANE" : "MIXED DAMAGE LANE",
        sprayDistribution: sameSide ? `${group[0].batSide} SIDE CLUSTER` : "BALANCED SPRAY",
        topAttackZones: group.map(h => `${h.player}: ${h.topZones}`).join(" || ")
      };

      stackRows.push(row);
      leverageRows.push({
        team: row.team,
        opponent: row.opponent,
        game: row.game,
        stackSize: row.stackSize,
        players: row.players,
        leverageScore: row.leverageScore,
        leverageProfile: row.leverageProfile,
        finalStackScore: row.finalStackScore,
        stackGrade: row.stackGrade,
        reason: `${row.correlatedHrLane} with ${row.pitcherCollapseProbability} pitcher collapse and ${row.hrChainReactionProbability} chain reaction`
      });
    }
  }
}

stackRows.sort((a, b) => b.finalStackScore - a.finalStackScore);
leverageRows.sort((a, b) => b.leverageScore - a.leverageScore);
collapseRows.sort((a, b) => Math.max(b.pitcherCollapseProbability, b.bullpenCollapseScore) - Math.max(a.pitcherCollapseProbability, a.bullpenCollapseScore));

const payload = {
  date: new Date().toISOString().slice(0, 10),
  updatedAt: new Date().toISOString(),
  source: "The Slip Lab Stack Intelligence 2.0",
  count: stackRows.length,
  stacks: stackRows
};

writeJson(OUTPUTS.stackIntel, payload);
writeJson(OUTPUTS.leverage, {
  updatedAt: new Date().toISOString(),
  count: leverageRows.length,
  profiles: leverageRows
});
writeJson(OUTPUTS.collapse, {
  updatedAt: new Date().toISOString(),
  count: collapseRows.length,
  alerts: collapseRows
});
writeCsv(OUTPUTS.csv, stackRows);

console.log("TEAM STACK INTELLIGENCE 2.0 COMPLETE");
console.log(`Stacks built: ${stackRows.length}`);
console.log(`Saved: ${OUTPUTS.stackIntel}`);
console.log(`Saved: ${OUTPUTS.leverage}`);
console.log(`Saved: ${OUTPUTS.collapse}`);
console.log(`Saved: ${OUTPUTS.csv}`);

console.table(stackRows.slice(0, 12).map(s => ({
  team: s.team,
  size: s.stackSize,
  players: s.players,
  grade: s.stackGrade,
  volatility: s.volatilityMeter,
  chain: s.hrChainReactionProbability
})));
