import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const HR_FILE = path.join(DATA_DIR, "mlb_home_runs.json");
const OUT_FILE = path.join(DATA_DIR, "statcast_zones.json");

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

function round(value, places = 3) {
  const mult = 10 ** places;
  return Math.round(value * mult) / mult;
}

function emptyGrid(value = 0) {
  return Array.from({ length: 25 }, () => value);
}

function buildPowerZones(player) {
  const hitter = player.stats?.hitter || {};

  const hr = n(hitter.hr);
  const slg = n(hitter.slg);
  const ops = n(hitter.ops);
  const avg = n(hitter.avg);
  const score = n(player.score);
  const side = String(player.batSide || "").toUpperCase();

  const powerBase = clamp(
    hr / 28 +
    slg / 1.35 +
    ops / 2.65 +
    score / 150,
    0.12,
    1.15
  );

  const avgGrid = emptyGrid();
  const isoGrid = emptyGrid();
  const slgGrid = emptyGrid();
  const xwobaGrid = emptyGrid();
  const hrGrid = emptyGrid();
  const kGrid = emptyGrid();
  const hardHitGrid = emptyGrid();
  const barrelGrid = emptyGrid();

  for (let index = 0; index < 25; index += 1) {
    const row = Math.floor(index / 5);
    const col = index % 5;

    const pullLane =
      side === "L"
        ? col >= 3
        : side === "R"
          ? col <= 1
          : col === 2;

    const middleLane = col === 2;
    const liftLane = row <= 2;
    const chaseLane = row === 0 || row === 4 || col === 0 || col === 4;

    let zoneBoost = 0;

    if (pullLane) zoneBoost += 0.22;
    if (middleLane) zoneBoost += 0.14;
    if (liftLane) zoneBoost += 0.13;
    if (chaseLane) zoneBoost -= 0.04;

    const heat = clamp(powerBase * 0.38 + zoneBoost, 0.03, 0.95);

    avgGrid[index] = round(clamp(avg * 0.75 + heat * 0.18, 0.05, 0.55));
    isoGrid[index] = round(clamp(heat * 0.62, 0.02, 0.85));
    slgGrid[index] = round(clamp(slg * 0.55 + heat * 0.46, 0.12, 1.25));
    xwobaGrid[index] = round(clamp(ops * 0.18 + heat * 0.34, 0.08, 0.75));
    hrGrid[index] = heat >= 0.58 ? 2 : heat >= 0.42 ? 1 : 0;
    kGrid[index] = round(clamp(0.14 + (chaseLane ? 0.13 : 0.03), 0.08, 0.42));
    hardHitGrid[index] = round(clamp(heat * 0.72, 0.05, 0.72));
    barrelGrid[index] = round(clamp(heat * 0.36, 0.02, 0.38));
  }

  return {
    avg: avgGrid,
    iso: isoGrid,
    slg: slgGrid,
    xwoba: xwobaGrid,
    hr: hrGrid,
    k: kGrid,
    hardHit: hardHitGrid,
    barrel: barrelGrid
  };
}

function main() {
  const board = readJson(HR_FILE, []);
  const players = Array.isArray(board) ? board : [];

  const output = {
    updated_at: new Date().toISOString(),
    source: "slip_lab_power_zone_model",
    note: "Modeled power zones from current HR board, hitter production, bat side, and HR score. Real Baseball Savant raw rows can be layered later.",
    players: {}
  };

  for (const player of players) {
    if (!player.player) continue;

    output.players[player.player] = {
      playerId: player.playerId || null,
      team: player.team || null,
      batSide: player.batSide || null,
      rows: 25,
      source: "slip_lab_power_zone_model",
      zones: buildPowerZones(player)
    };
  }

  writeJson(OUT_FILE, output);

  console.log("STATCAST POWER ZONES COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
