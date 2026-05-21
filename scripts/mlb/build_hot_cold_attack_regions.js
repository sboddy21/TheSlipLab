import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const HR_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const STATCAST_FILE = path.join(ROOT, "website", "data", "statcast_zones.json");
const ATTACK_FILE = path.join(ROOT, "website", "data", "pitcher_attack_zones.json");
const OUT_FILE = path.join(ROOT, "website", "data", "hot_cold_attack_regions.json");

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

function classify(value) {
  if (value >= 78) return "hot";
  if (value >= 58) return "warm";
  if (value <= 32) return "cold";
  return "neutral";
}

function laneName(index, batSide) {
  const col = index % 5;
  const side = String(batSide || "B").toUpperCase();

  if (col === 2) return "Middle";

  if (side === "L") {
    if (col >= 3) return "Pull Side";
    return "Oppo Side";
  }

  if (side === "R") {
    if (col <= 1) return "Pull Side";
    return "Oppo Side";
  }

  if (col <= 1) return "Left Lane";
  return "Right Lane";
}

function buildRegions(row, statcast, attack) {
  const playerZones = statcast.players?.[row.player]?.zones || {};
  const attackZones = attack.players?.[row.player]?.zones?.zones || [];

  const iso = playerZones.iso || [];
  const hr = playerZones.hr || [];
  const barrel = playerZones.barrel || [];
  const hardHit = playerZones.hardHit || [];

  const regions = [];

  for (let index = 0; index < 25; index += 1) {
    const hitterHeat = clamp(
      n(iso[index]) * 45 +
      n(hr[index]) * 16 +
      n(barrel[index]) * 60 +
      n(hardHit[index]) * 35,
      0,
      99
    );

    const pitcherDanger = n(attackZones[index]?.danger, 40);
    const combined = Math.round(clamp(hitterHeat * 0.52 + pitcherDanger * 0.48, 0, 99));

    regions.push({
      zone: index + 1,
      hitterHeat: Math.round(hitterHeat),
      pitcherDanger,
      combined,
      region: classify(combined),
      lane: laneName(index, row.batSide)
    });
  }

  const hotRegions = regions.filter(region => region.region === "hot").length;
  const coldRegions = regions.filter(region => region.region === "cold").length;
  const best = [...regions].sort((a, b) => b.combined - a.combined)[0];

  const bestLane = best?.lane || "Middle";

  return {
    batSide: row.batSide || "B",
    hotRegions,
    coldRegions,
    bestLane,
    bestZone: best?.zone || null,
    bestScore: best?.combined || 0,
    read:
      hotRegions >= 6
        ? `Multiple hot attack regions. Best lane: ${bestLane}.`
        : hotRegions >= 3
          ? `Playable hot region cluster. Best lane: ${bestLane}.`
          : `Limited hot regions. Best lane: ${bestLane}.`,
    regions
  };
}

function main() {
  const board = readJson(HR_FILE, []);
  const statcast = readJson(STATCAST_FILE, { players: {} });
  const attack = readJson(ATTACK_FILE, { players: {} });

  const rows = Array.isArray(board) ? board : [];

  const output = {
    updated_at: new Date().toISOString(),
    source: "slip_lab_hot_cold_attack_regions",
    players: {}
  };

  for (const row of rows) {
    if (!row.player) continue;

    output.players[row.player] = {
      playerId: row.playerId || null,
      team: row.team || null,
      regions: buildRegions(row, statcast, attack)
    };
  }

  writeJson(OUT_FILE, output);

  console.log("HOT COLD ATTACK REGIONS COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
