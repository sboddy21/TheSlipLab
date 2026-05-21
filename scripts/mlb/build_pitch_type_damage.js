import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const HR_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const OUT_FILE = path.join(ROOT, "website", "data", "pitch_type_damage.json");

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

const PITCH_TYPES = [
  {
    key: "fourSeam",
    label: "4 Seam",
    boost: ["R", "L"]
  },
  {
    key: "sinker",
    label: "Sinker",
    boost: ["R"]
  },
  {
    key: "slider",
    label: "Slider",
    boost: ["L"]
  },
  {
    key: "cutter",
    label: "Cutter",
    boost: ["R", "L"]
  },
  {
    key: "changeup",
    label: "Changeup",
    boost: ["L"]
  },
  {
    key: "curveball",
    label: "Curveball",
    boost: ["R"]
  }
];

function buildPitchDamage(player) {
  const hitter = player.stats?.hitter || {};

  const hr = n(hitter.hr);
  const slg = n(hitter.slg);
  const ops = n(hitter.ops);
  const avg = n(hitter.avg);
  const score = n(player.score);
  const side = String(player.batSide || "").toUpperCase();

  const power = clamp(
    hr / 25 +
    slg / 1.25 +
    ops / 2.4 +
    score / 140,
    0.15,
    1.25
  );

  const output = {};

  for (const pitch of PITCH_TYPES) {
    const sideBoost = pitch.boost.includes(side) ? 0.16 : 0.05;

    const damage = clamp(power * 0.42 + sideBoost, 0.08, 0.95);

    const whiffPenalty =
      pitch.key === "slider"
        ? 0.12
        : pitch.key === "curveball"
          ? 0.09
          : 0.05;

    output[pitch.key] = {
      label: pitch.label,
      avg: round(clamp(avg * 0.72 + damage * 0.14, 0.08, 0.48)),
      slg: round(clamp(slg * 0.58 + damage * 0.52, 0.12, 1.35)),
      hr: Math.round(clamp(damage * 4.5, 0, 4)),
      barrel: round(clamp(damage * 0.38, 0.04, 0.42)),
      hardHit: round(clamp(damage * 0.72, 0.08, 0.78)),
      whiff: round(clamp(whiffPenalty + (1 - damage) * 0.12, 0.12, 0.42)),
      crush: round(clamp(damage * 100, 8, 99))
    };
  }

  return output;
}

function main() {
  const board = readJson(HR_FILE, []);
  const rows = Array.isArray(board) ? board : [];

  const output = {
    updated_at: new Date().toISOString(),
    source: "slip_lab_pitch_damage_model",
    players: {}
  };

  for (const row of rows) {
    if (!row.player) continue;

    output.players[row.player] = {
      playerId: row.playerId || null,
      team: row.team || null,
      batSide: row.batSide || null,
      pitchDamage: buildPitchDamage(row)
    };
  }

  writeJson(OUT_FILE, output);

  console.log("PITCH TYPE DAMAGE COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
