import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const HR_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const OUT_FILE = path.join(ROOT, "website", "data", "launch_angle_clusters.json");

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

function buildClusters(row) {
  const hitter = row.stats?.hitter || {};

  const hr = n(hitter.hr);
  const slg = n(hitter.slg);
  const ops = n(hitter.ops);
  const score = n(row.score);
  const side = String(row.batSide || "B").toUpperCase();

  const power = clamp(hr / 26 + slg / 1.3 + ops / 2.55 + score / 155, 0.1, 1.25);

  const ideal = clamp(22 + power * 9, 18, 31);
  const low = clamp(ideal - 8, 8, 24);
  const high = clamp(ideal + 8, 26, 42);

  const pullBias = side === "L" ? 65 : side === "R" ? 35 : 50;

  const clusters = [
    {
      label: "Low Line Drive",
      angleRange: "8 to 17",
      launchAngle: Math.round(low),
      exitVelo: Math.round(clamp(90 + power * 9, 88, 111)),
      hrFit: Math.round(clamp(power * 42, 8, 72)),
      x: clamp(pullBias - 18, 18, 82),
      y: 72
    },
    {
      label: "Ideal HR Window",
      angleRange: "18 to 32",
      launchAngle: Math.round(ideal),
      exitVelo: Math.round(clamp(95 + power * 10, 92, 115)),
      hrFit: Math.round(clamp(power * 78, 18, 99)),
      x: pullBias,
      y: 48
    },
    {
      label: "High Carry",
      angleRange: "33 to 42",
      launchAngle: Math.round(high),
      exitVelo: Math.round(clamp(92 + power * 8, 89, 110)),
      hrFit: Math.round(clamp(power * 54, 10, 86)),
      x: clamp(pullBias + 14, 18, 82),
      y: 30
    }
  ];

  return {
    side,
    idealAngle: Math.round(ideal),
    bestWindow: "18 to 32",
    powerArc: Math.round(clamp(power * 100, 10, 99)),
    clusters
  };
}

function main() {
  const board = readJson(HR_FILE, []);
  const rows = Array.isArray(board) ? board : [];

  const output = {
    updated_at: new Date().toISOString(),
    source: "slip_lab_launch_angle_model",
    players: {}
  };

  for (const row of rows) {
    if (!row.player) continue;

    output.players[row.player] = {
      playerId: row.playerId || null,
      team: row.team || null,
      launchProfile: buildClusters(row)
    };
  }

  writeJson(OUT_FILE, output);

  console.log("LAUNCH ANGLE CLUSTERS COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
