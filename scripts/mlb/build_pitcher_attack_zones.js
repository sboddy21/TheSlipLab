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

  const side = String(row.batSide || "B").toUpperCase();

  const hitterPower = clamp(hr / 24 + slg / 1.25 + ops / 2.5 + score / 150, 0.12, 1.2);
  const pitcherLeak = clamp(era / 6.5 + whip / 2 + hrAllowed / 18, 0.08, 1.15);

  const zones = [];

  for (let index = 0; index < 25; index += 1) {
    const rowIndex = Math.floor(index / 5);
    const colIndex = index % 5;

    const heart = rowIndex >= 1 && rowIndex <= 3 && colIndex >= 1 && colIndex <= 3;
    const upper = rowIndex <= 1;
    const pull = side === "L" ? colIndex >= 3 : side === "R" ? colIndex <= 1 : colIndex === 2;

    let danger = hitterPower * 0.48 + pitcherLeak * 0.42;

    if (heart) danger += 0.16;
    if (upper) danger += 0.08;
    if (pull) danger += 0.12;

    danger = clamp(danger, 0.04, 0.98);

    zones.push({
      zone: index + 1,
      danger: Math.round(danger * 100),
      attack:
        danger >= 75
          ? "Red"
          : danger >= 55
            ? "Orange"
            : danger >= 38
              ? "Yellow"
              : "Blue"
    });
  }

  return {
    side,
    hitterPower: Math.round(hitterPower * 100),
    pitcherLeak: Math.round(pitcherLeak * 100),
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
