import fs from "fs";
import path from "path";

const ROOT = path.resolve();
const DATA_DIR = path.join(ROOT, "data");

const MASTER_FILE = path.join(DATA_DIR, "master_hr_model.csv");
const WEATHER_FILE = path.join(DATA_DIR, "weather_environment_engine.csv");
const BULLPEN_FILE = path.join(DATA_DIR, "bullpen_usage.csv");
const PITCHER_ATTACK_FILE = path.join(DATA_DIR, "pitcher_attack_sheet.csv");

const OUTPUT_CSV = path.join(DATA_DIR, "team_stack_intelligence_2.csv");
const OUTPUT_JSON = path.join(DATA_DIR, "team_stack_intelligence_2.json");

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && insideQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function loadCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Missing file: ${filePath}`);
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/);
  const headers = parseCSVLine(lines.shift()).map(h => h.trim());

  return lines.map(line => {
    const values = parseCSVLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCSV(filePath, rows) {
  if (!rows.length) {
    fs.writeFileSync(filePath, "");
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(","))
  ];

  fs.writeFileSync(filePath, lines.join("\n"));
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clean(value) {
  return String(value || "").trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(arr) {
  const filtered = arr.filter(v => Number.isFinite(v));
  if (!filtered.length) return 0;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

function key(value) {
  return clean(value).toLowerCase();
}

function getWeatherBoost(weatherRows, game) {
  const row = weatherRows.find(r => key(r.game) === key(game));
  if (!row) return 0;
  return num(row.weather_boost);
}

function getBullpenData(rows, team) {
  return rows.find(r => key(r.team) === key(team));
}

function getPitcherAttack(rows, pitcher) {
  return rows.find(r => key(r.pitcher) === key(pitcher));
}

function calculatePitcherCollapseProbability(pitcherAttack) {
  if (!pitcherAttack) return 50;

  const attackScore = num(pitcherAttack.attack_score);
  const era = num(pitcherAttack.era);
  const whip = num(pitcherAttack.whip);
  const hr9 = num(pitcherAttack.hr_per_9);
  const barrel = num(pitcherAttack.barrel_allowed_pct);

  const score =
    attackScore * 0.35 +
    era * 4 +
    whip * 12 +
    hr9 * 12 +
    barrel * 1.5;

  return clamp(Math.round(score), 1, 99);
}

function calculateBullpenCollapseScore(bullpen) {
  if (!bullpen) return 50;

  const usage = num(bullpen.used);
  const b2b = num(bullpen.b2b);
  const pitches = num(bullpen.pitches);
  const innings = num(bullpen.innings);
  const bullpenScore = num(bullpen.score);

  const score =
    usage * 10 +
    b2b * 18 +
    pitches * 0.08 +
    innings * 1.4 +
    bullpenScore * 0.7;

  return clamp(Math.round(score), 1, 99);
}

function classifyVolatility(score) {
  if (score >= 90) return "NUCLEAR";
  if (score >= 75) return "AGGRESSIVE";
  if (score >= 60) return "BALANCED";
  if (score >= 45) return "SAFE";
  return "LOTTO";
}

function classifyLeverage(score) {
  if (score >= 85) return "ELITE";
  if (score >= 70) return "STRONG";
  if (score >= 55) return "SOLID";
  if (score >= 40) return "MID";
  return "LOW";
}

function buildCombinations(players, size) {
  const results = [];

  function helper(start, combo) {
    if (combo.length === size) {
      results.push([...combo]);
      return;
    }

    for (let i = start; i < players.length; i++) {
      combo.push(players[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }

  helper(0, []);
  return results;
}

console.log("");
console.log("TEAM STACK INTELLIGENCE 2.0");
console.log("");

const masterRows = loadCSV(MASTER_FILE);
const weatherRows = loadCSV(WEATHER_FILE);
const bullpenRows = loadCSV(BULLPEN_FILE);
const pitcherAttackRows = loadCSV(PITCHER_ATTACK_FILE);

if (!masterRows.length) {
  console.log("No master HR rows found");
  process.exit(1);
}

const groupedTeams = {};

for (const row of masterRows) {
  const team = clean(row.team);
  if (!team) continue;

  if (!groupedTeams[team]) groupedTeams[team] = [];
  groupedTeams[team].push(row);
}

const finalStacks = [];

for (const [team, hitters] of Object.entries(groupedTeams)) {
  const sortedHitters = hitters
    .map(h => {
      const hrScore =
        num(h.final_score) ||
        num(h.hr_score) ||
        num(h.score) ||
        num(h.model_score);

      return { ...h, hrScore };
    })
    .filter(h => clean(h.player) && h.hrScore > 0)
    .sort((a, b) => b.hrScore - a.hrScore)
    .slice(0, 7);

  if (sortedHitters.length < 2) continue;

  const sample = sortedHitters[0];
  const game = clean(sample.game);
  const opponent = clean(sample.opponent || sample.opp || sample.away_team || sample.home_team);
  const opposingPitcher = clean(sample.pitcher || sample.opposing_pitcher || sample.probable_pitcher);

  const weatherBoost = getWeatherBoost(weatherRows, game);
  const bullpen = getBullpenData(bullpenRows, opponent);
  const pitcherAttack = getPitcherAttack(pitcherAttackRows, opposingPitcher);

  const pitcherCollapse = calculatePitcherCollapseProbability(pitcherAttack);
  const bullpenCollapse = calculateBullpenCollapseScore(bullpen);

  for (const size of [2, 3, 4]) {
    const combos = buildCombinations(sortedHitters, size);

    for (const combo of combos) {
      const players = combo.map(c => clean(c.player));
      const avgHRScore = average(combo.map(c => c.hrScore));

      const firstBats = clean(combo[0].bats || combo[0].stand);
      const handednessCorrelation = combo.filter(c => clean(c.bats || c.stand) === firstBats).length;

      const recentForm = average(combo.map(c => num(c.recent_hr_score) || num(c.trend_score)));
      const power = average(combo.map(c => num(c.barrel_pct) + num(c.hard_hit_pct)));

      const leverageScore =
        avgHRScore * 0.4 +
        pitcherCollapse * 0.2 +
        bullpenCollapse * 0.2 +
        weatherBoost * 3 +
        recentForm * 0.1 +
        power * 0.1;

      const correlationScore =
        handednessCorrelation * 12 +
        weatherBoost * 4 +
        pitcherCollapse * 0.45 +
        bullpenCollapse * 0.25;

      const chainReactionProbability = clamp(
        Math.round(leverageScore * 0.45 + correlationScore * 0.55),
        1,
        99
      );

      const volatility = clamp(
        Math.round(avgHRScore * 0.45 + power * 0.3 + pitcherCollapse * 0.15 + bullpenCollapse * 0.1),
        1,
        99
      );

      finalStacks.push({
        date: new Date().toISOString(),
        team,
        stack_size: size,
        players: players.join(" | "),
        game,
        opponent,
        opposing_pitcher: opposingPitcher,
        avg_hr_score: avgHRScore.toFixed(2),
        leverage_score: leverageScore.toFixed(2),
        leverage_grade: classifyLeverage(leverageScore),
        correlation_score: correlationScore.toFixed(2),
        pitcher_collapse_probability: pitcherCollapse,
        bullpen_collapse_score: bullpenCollapse,
        weather_boost: weatherBoost,
        stack_volatility_score: volatility,
        stack_volatility_label: classifyVolatility(volatility),
        hr_chain_reaction_probability: chainReactionProbability,
        spray_distribution_bias: handednessCorrelation >= size ? "PULL SIDE HEAVY" : "BALANCED",
        correlated_hr_lane: handednessCorrelation >= size ? "STRONG" : "MODERATE"
      });
    }
  }
}

finalStacks.sort((a, b) =>
  num(b.hr_chain_reaction_probability) - num(a.hr_chain_reaction_probability)
);

writeCSV(OUTPUT_CSV, finalStacks);
fs.writeFileSync(OUTPUT_JSON, JSON.stringify(finalStacks, null, 2));

console.log("TEAM STACK INTELLIGENCE 2.0 COMPLETE");
console.log(`Stacks Built: ${finalStacks.length}`);
console.log(`Saved: ${OUTPUT_CSV}`);
console.log(`Saved: ${OUTPUT_JSON}`);

console.table(
  finalStacks.slice(0, 15).map(s => ({
    team: s.team,
    size: s.stack_size,
    players: s.players,
    leverage: s.leverage_grade,
    volatility: s.stack_volatility_label,
    chain: s.hr_chain_reaction_probability
  }))
);
