import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");

const HR_FILE = path.join(DATA_DIR, "mlb_home_runs.json");
const CARD_FILE = path.join(DATA_DIR, "player_card_profiles.json");
const OUT_FILE = path.join(DATA_DIR, "pitch_type_damage.json");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
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
  if (value === null || value === undefined || value === "") return fallback;
  const x = Number(String(value).replace("%", "").replace("+", "").trim());
  return Number.isFinite(x) ? x : fallback;
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 3) {
  const mult = 10 ** places;
  return Math.round(n(value) * mult) / mult;
}

function rowsFrom(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.rows)) return input.rows;
  if (Array.isArray(input?.data)) return input.data;
  if (Array.isArray(input?.players)) return input.players;
  if (input?.players && typeof input.players === "object") {
    return Object.entries(input.players).map(([player, value]) => ({ player, ...value }));
  }
  return [];
}

function playerName(row) {
  return clean(row.player || row.name || row.batter || row.hitter || row.player_name);
}

function makePlayerMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const player = playerName(row);
    if (player) map.set(norm(player), row);
  }
  return map;
}

const PITCHES = [
  { key: "fourSeam", label: "4 Seam", bias: 0.98 },
  { key: "sinker", label: "Sinker", bias: 0.93 },
  { key: "slider", label: "Slider", bias: 1.02 },
  { key: "cutter", label: "Cutter", bias: 0.97 },
  { key: "changeup", label: "Changeup", bias: 0.95 },
  { key: "curveball", label: "Curveball", bias: 0.91 }
];

const HANDED_PROFILE = {
  L: {
    fourSeam: 1.00,
    sinker: 0.93,
    slider: 1.06,
    cutter: 1.02,
    changeup: 0.96,
    curveball: 0.94
  },
  R: {
    fourSeam: 0.99,
    sinker: 1.03,
    slider: 1.01,
    cutter: 0.98,
    changeup: 0.95,
    curveball: 0.96
  }
};

function cardPitchSignals(card) {
  const candidates = [
    card?.pitchTypeDamage,
    card?.pitchDamage,
    card?.pitches,
    card?.pitchProfile,
    card?.pitchTypeProfile,
    card?.matchup?.pitchDamage,
    card?.matchup?.pitches
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }

  return null;
}

function pullPitchStats(profile, key) {
  const direct = profile?.[key];
  if (direct && typeof direct === "object") return direct;

  const targetLabels = {
    fourSeam: ["4 Seam", "Four Seam", "Four-Seam", "FF"],
    sinker: ["Sinker", "SI"],
    slider: ["Slider", "SL"],
    cutter: ["Cutter", "FC"],
    changeup: ["Changeup", "Change Up", "CH"],
    curveball: ["Curveball", "Curve", "CU", "KC"]
  };

  for (const [k, value] of Object.entries(profile || {})) {
    const label = clean(value?.label || k).toLowerCase();
    if (targetLabels[key].some(x => label.includes(x.toLowerCase()))) {
      return value;
    }
  }

  return null;
}

function buildEstimatedPitchDamage(row, card) {
  const hitter = row.stats?.hitter || {};
  const side = clean(row.batSide || card?.batSide).toUpperCase();

  const hr = n(hitter.hr);
  const slg = n(hitter.slg);
  const ops = n(hitter.ops);
  const avg = n(hitter.avg);
  const score = n(row.score || row.hrScore || row.modelScore);
  const hardHitBase = n(card?.hardHitRate || card?.hardHit || hitter.hardHit, 43) / 100;
  const barrelBase = n(card?.barrelRate || card?.barrel || hitter.barrel, 10) / 100;

  const power = clamp(
    hr / 32 + slg / 1.4 + ops / 2.7 + score / 165,
    0.18,
    1.05
  );

  const handed = HANDED_PROFILE[side] || HANDED_PROFILE.R;
  const output = {};

  for (const pitch of PITCHES) {
    const pitchMod = handed[pitch.key] || 1;
    const uniqueSeed = ((norm(playerName(row)).charCodeAt(0) || 80) % 13) / 100;
    const damage = clamp(power * pitch.bias * pitchMod + uniqueSeed, 0.08, 0.95);

    output[pitch.key] = {
      label: pitch.label,
      avg: round(clamp(avg * 0.72 + damage * 0.13, 0.08, 0.48)),
      slg: round(clamp(slg * 0.52 + damage * 0.47, 0.12, 1.35)),
      hr: Math.round(clamp(damage * 4.2, 0, 4)),
      barrel: round(clamp(barrelBase * pitchMod + damage * 0.12, 0.035, 0.42)),
      hardHit: round(clamp(hardHitBase * pitchMod + damage * 0.18, 0.08, 0.78)),
      whiff: round(clamp(0.14 + (1 - damage) * 0.13 + (pitch.key === "slider" ? 0.035 : 0), 0.12, 0.42)),
      crush: round(clamp(damage * 88 + n(output[pitch.key]?.barrel) * 10, 8, 99))
    };
  }

  return output;
}

function buildRealPitchDamage(row, card) {
  const profile = cardPitchSignals(card);
  if (!profile) return null;

  const output = {};
  let usable = 0;

  for (const pitch of PITCHES) {
    const p = pullPitchStats(profile, pitch.key);
    if (!p) continue;

    const avg = n(p.avg || p.ba || p.battingAverage);
    const slg = n(p.slg || p.slugging);
    const hr = n(p.hr || p.homeRuns);
    const barrel = n(p.barrel || p.barrelRate) > 1 ? n(p.barrel || p.barrelRate) / 100 : n(p.barrel || p.barrelRate);
    const hardHit = n(p.hardHit || p.hardHitRate) > 1 ? n(p.hardHit || p.hardHitRate) / 100 : n(p.hardHit || p.hardHitRate);
    const whiff = n(p.whiff || p.whiffRate) > 1 ? n(p.whiff || p.whiffRate) / 100 : n(p.whiff || p.whiffRate);

    const crush = n(p.crush || p.score || p.damageScore,
      avg * 20 + slg * 28 + hr * 5 + barrel * 100 * 0.28 + hardHit * 100 * 0.20
    );

    output[pitch.key] = {
      label: pitch.label,
      avg: round(avg),
      slg: round(slg),
      hr: Math.round(clamp(hr, 0, 9)),
      barrel: round(clamp(barrel, 0, 0.55)),
      hardHit: round(clamp(hardHit, 0, 0.85)),
      whiff: round(clamp(whiff, 0.05, 0.55)),
      crush: round(clamp(crush, 0, 99))
    };

    usable += 1;
  }

  return usable >= 2 ? output : null;
}

function main() {
  const hrRows = rowsFrom(readJson(HR_FILE, []));
  const cardRows = rowsFrom(readJson(CARD_FILE, []));
  const cardMap = makePlayerMap(cardRows);

  const output = {
    updated_at: new Date().toISOString(),
    source: "slip_lab_pitch_damage_model_v2",
    note: "Uses real player card pitch fields when available. Falls back to varied estimated pitch profiles instead of cloning the same pitch profile.",
    players: {}
  };

  for (const row of hrRows) {
    const player = playerName(row);
    if (!player) continue;

    const card = cardMap.get(norm(player)) || {};
    const realDamage = buildRealPitchDamage(row, card);
    const pitchDamage = realDamage || buildEstimatedPitchDamage(row, card);

    output.players[player] = {
      playerId: row.playerId || card.playerId || null,
      team: row.team || card.team || null,
      batSide: row.batSide || card.batSide || null,
      pitchDamage,
      pitchDamageSource: realDamage ? "player_card_pitch_profile" : "estimated_varied_profile"
    };
  }

  writeJson(OUT_FILE, output);

  console.log("PITCH TYPE DAMAGE COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
