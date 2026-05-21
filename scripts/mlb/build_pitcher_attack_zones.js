import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const HR_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const OUT_FILE = path.join(ROOT, "website", "data", "pitcher_attack_zones.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function n(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildZoneGrid(row) {
  const hitter = row.stats?.hitter || {};
  const pitcher = row.stats?.pitcher || {};

  const hr = n(hitter.hr);
  const slg = n(hitter.slg);
  const ops = n(hitter.ops);
  const score = n(row.score);

  const era = n(pitcher.era);
  const whip = n(pitcher.whip);
  const hrAllowed = n(pitcher.homeRuns);
  const hitsAllowed = n(pitcher.hits);
  const ip = n(pitcher.inningsPitched);

  const side = String(row.batSide || "B").toUpperCase();

  const hitterPower = clamp(
    hr * 1.15 +
    slg * 22 +
    ops * 12 +
    score * 0.35,
    8,
    99
  );

  const pitcherLeak = clamp(
    era * 5.8 +
    whip * 12 +
    hrAllowed * 3.8 +
    (ip > 0 ? hitsAllowed / ip * 10 : 0),
    8,
    99
  );

  const baseDanger = clamp((hitterPower * 0.48) + (pitcherLeak * 0.42), 10, 88);

  const zones = [];

  for (let index = 0; index < 25; index += 1) {
    const rowIndex = Math.floor(index / 5);
    const colIndex = index % 5;

    const heart = rowIndex >= 1 && rowIndex <= 3 && colIndex >= 1 && colIndex <= 3;
    const upper = rowIndex <= 1;
    const lower = rowIndex >= 3;
    const edge = rowIndex === 0 || rowIndex === 4 || colIndex === 0 || colIndex === 4;
    const pull = side === "L" ? colIndex >= 3 : side === "R" ? colIndex <= 1 : colIndex === 2;
    const middle = colIndex === 2;

    let danger = baseDanger;

    if (heart) danger += 8;
    if (upper) danger += 5;
    if (pull) danger += 7;
    if (middle) danger += 3;
    if (lower) danger -= 4;
    if (edge) danger -= 10;

    const variation = ((index * 7) % 11) - 5;
    danger = Math.round(clamp(danger + variation, 12, 92));

    zones.push({
      zone: index + 1,
      danger,
      attack:
        danger >= 78
          ? "Red"
          : danger >= 62
            ? "Orange"
            : danger >= 44
              ? "Yellow"
              : "Blue"
    });
  }

  return {
    side,
    hitterPower: Math.round(hitterPower),
    pitcherLeak: Math.round(pitcherLeak),
    zones
  };
}

function main() {
  const board = readJson(HR_FILE, []);
  const rows = Array.isArray(board) ? board : [];

  const output = {
    updated_at: new Date().toISOString(),
    source: "slip_lab_pitcher_attack_zones",
    players: {}
  };

  for (const row of rows) {
    if (!row.player) continue;

    output.players[row.player] = {
      playerId: row.playerId || null,
      team: row.team || null,
      zones: buildZoneGrid(row)
    };
  }

  writeJson(OUT_FILE, output);

  console.log("PITCHER ATTACK ZONES COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
