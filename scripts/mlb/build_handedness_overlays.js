import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const HR_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const OUT_FILE = path.join(ROOT, "website", "data", "handedness_overlays.json");

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

function buildOverlay(row) {
  const hitter = row.stats?.hitter || {};
  const pitcher = row.stats?.pitcher || {};

  const batSide = String(row.batSide || "B").toUpperCase();
  const hr = n(hitter.hr);
  const slg = n(hitter.slg);
  const ops = n(hitter.ops);
  const score = n(row.score);

  const era = n(pitcher.era);
  const whip = n(pitcher.whip);
  const hrAllowed = n(pitcher.homeRuns);

  const hitterPower = clamp(hr / 24 + slg / 1.25 + ops / 2.5 + score / 150, 0.1, 1.25);
  const pitcherLeak = clamp(era / 7 + whip / 2 + hrAllowed / 18, 0.05, 1.2);

  const sameSidePenalty = batSide === "L" || batSide === "R" ? 0.08 : 0;
  const splitAdvantage = clamp((hitterPower * 54) + (pitcherLeak * 34) - sameSidePenalty * 100, 8, 99);

  const pull = batSide === "L"
    ? clamp(42 + hitterPower * 28, 25, 78)
    : clamp(43 + hitterPower * 27, 25, 78);

  const center = clamp(26 + hitterPower * 10, 15, 42);
  const oppo = clamp(100 - pull - center, 8, 35);

  return {
    batSide,
    matchupSide: batSide === "L" ? "Left handed bat lane" : batSide === "R" ? "Right handed bat lane" : "Switch hitter lane",
    splitAdvantage: Math.round(splitAdvantage),
    pull: Math.round(pull),
    center: Math.round(center),
    oppo: Math.round(oppo),
    pitcherLeak: Math.round(clamp(pitcherLeak * 100, 0, 99)),
    hitterPower: Math.round(clamp(hitterPower * 100, 0, 99)),
    read:
      splitAdvantage >= 75
        ? "Strong handedness fit"
        : splitAdvantage >= 55
          ? "Playable handedness fit"
          : "Neutral handedness fit"
  };
}

function main() {
  const board = readJson(HR_FILE, []);
  const rows = Array.isArray(board) ? board : [];

  const output = {
    updated_at: new Date().toISOString(),
    source: "slip_lab_handedness_overlay_model",
    players: {}
  };

  for (const row of rows) {
    if (!row.player) continue;

    output.players[row.player] = {
      playerId: row.playerId || null,
      team: row.team || null,
      overlay: buildOverlay(row)
    };
  }

  writeJson(OUT_FILE, output);

  console.log("HANDEDNESS OVERLAYS COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
