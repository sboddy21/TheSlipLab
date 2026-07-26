import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const HISTORY_FILE = path.join(DATA_DIR, "hr_results_history.json");
const OUT_FILE = path.join(DATA_DIR, "mlb_ball_carry_index.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function todayEastern() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(digits));
}

function pct(value) {
  return round(value * 100, 1);
}

function isHomeRun(row) {
  const category = String(row?.category || "").toLowerCase();
  const event = String(row?.event || row?.eventType || "").toLowerCase();
  return category === "home_run" || event.includes("home run") || event.includes("home_run");
}

function isBarrelContact(row) {
  if (row?.isBarrel === true || String(row?.isBarrel).toLowerCase() === "true") return true;

  const ev = num(row?.exitVelocity);
  const la = num(row?.launchAngle);
  if (ev === null || la === null || ev < 98) return false;

  const over98 = Math.min(ev - 98, 18);
  const minLaunchAngle = 26 - over98;
  const maxLaunchAngle = 30 + over98 * (20 / 18);
  return la >= minLaunchAngle && la <= maxLaunchAngle;
}

function normalizeDayRows(day) {
  const homeRuns = Array.isArray(day?.homeRuns) ? day.homeRuns : [];
  const playerEvents = Array.isArray(day?.playerEvents) ? day.playerEvents : [];
  const rows = playerEvents.length ? playerEvents : homeRuns;
  const seen = new Set();

  return rows.filter(row => {
    const key = [
      row?.date || day?.date || "",
      row?.gamePk || "",
      row?.playId || "",
      row?.playerId || row?.player || "",
      row?.category || row?.eventType || row?.event || "",
      row?.endTime || ""
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(row => ({ ...row, date: row?.date || day?.date || "" }));
}

function collectWindow(days, dayCount) {
  return days.slice(0, dayCount).flatMap(normalizeDayRows);
}

function summarize(rows, days = []) {
  const battedBalls = rows.filter(row => num(row.exitVelocity) !== null && num(row.launchAngle) !== null);
  const barrels = battedBalls.filter(isBarrelContact);
  const barrelHomeRuns = barrels.filter(isHomeRun);
  const homeRuns = rows.filter(isHomeRun);
  const warningTrack = battedBalls.filter(row => {
    const distance = num(row.distance);
    return !isHomeRun(row) && distance !== null && distance >= 350 && distance <= 410;
  });
  const barrelDistances = barrels.map(row => num(row.distance)).filter(value => value !== null && value > 0);
  const hrGames = days.reduce((sum, day) => sum + Number(day?.checkedGames || day?.totalScheduledGames || 0), 0);

  return {
    days: days.length,
    games: hrGames,
    trackedBattedBalls: battedBalls.length,
    homeRuns: homeRuns.length,
    barrels: barrels.length,
    barrelHomeRuns: barrelHomeRuns.length,
    warningTrackEvents: warningTrack.length,
    barrelHrRate: barrels.length ? barrelHomeRuns.length / barrels.length : 0,
    hrPerGame: hrGames ? homeRuns.length / hrGames : 0,
    warningTrackRate: battedBalls.length ? warningTrack.length / battedBalls.length : 0,
    avgBarrelDistance: barrelDistances.length
      ? barrelDistances.reduce((sum, value) => sum + value, 0) / barrelDistances.length
      : 0
  };
}

function confidenceLabel(sample) {
  if (sample.barrels >= 45 && sample.trackedBattedBalls >= 160) return "high";
  if (sample.barrels >= 20 && sample.trackedBattedBalls >= 80) return "medium";
  return "low";
}

function carryLabel(carryIndex, confidence) {
  if (confidence === "low") return "building sample";
  if (carryIndex >= 1.1) return "ball carrying hot";
  if (carryIndex >= 1.04) return "slight carry boost";
  if (carryIndex <= 0.9) return "ball carrying dead";
  if (carryIndex <= 0.96) return "slight carry drag";
  return "neutral carry";
}

function main() {
  const history = readJSON(HISTORY_FILE, { days: [] });
  const days = (Array.isArray(history?.days) ? history.days : [])
    .filter(day => day?.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const sampledDays = days.filter(day => Array.isArray(day?.playerEvents) && day.playerEvents.length >= 50);

  const date = sampledDays[0]?.date || days[0]?.date || todayEastern();
  const recentDays = sampledDays.slice(0, 7);
  const seasonDays = sampledDays;
  const recent = summarize(collectWindow(sampledDays, 7), recentDays);
  const season = summarize(collectWindow(sampledDays, sampledDays.length), seasonDays);

  const barrelLift = season.barrelHrRate > 0 ? recent.barrelHrRate / season.barrelHrRate : 1;
  const distanceLift = season.avgBarrelDistance > 0 ? (recent.avgBarrelDistance - season.avgBarrelDistance) / 25 : 0;
  const hrLift = season.hrPerGame > 0 ? recent.hrPerGame / season.hrPerGame : 1;
  const warningTrackLift = season.warningTrackRate > 0 ? recent.warningTrackRate / season.warningTrackRate : 1;

  const rawCarryIndex =
    barrelLift * 0.48 +
    hrLift * 0.22 +
    warningTrackLift * 0.12 +
    (1 + distanceLift) * 0.18;

  const carryIndex = Math.max(0.75, Math.min(1.25, rawCarryIndex || 1));
  const estimatedFeetBoost = (carryIndex - 1) * 50;
  const confidence = confidenceLabel(recent);

  const output = {
    updatedAt: new Date().toISOString(),
    schemaVersion: "1.0",
    date,
    mode: "informational_only",
    source: "The Slip Lab tracked MLB batted-ball results",
    carryIndex: round(carryIndex, 3),
    carryScore: round(carryIndex * 100, 1),
    carryLabel: carryLabel(carryIndex, confidence),
    estimatedFeetBoost: round(estimatedFeetBoost, 1),
    confidence,
    note: "This is a conservative league-wide carry environment read. It is displayed for context and does not directly change HR scoring yet.",
    sampleRules: {
      includedDays: sampledDays.length,
      minimumTrackedEventsPerDay: 50,
      baseline: "only days with full tracked batted-ball event samples are used"
    },
    recentWindow: {
      label: "last 7 tracked days",
      days: recent.days,
      games: recent.games,
      trackedBattedBalls: recent.trackedBattedBalls,
      barrels: recent.barrels,
      barrelHomeRuns: recent.barrelHomeRuns,
      barrelHrRate: pct(recent.barrelHrRate),
      avgBarrelDistance: round(recent.avgBarrelDistance, 1),
      homeRuns: recent.homeRuns,
      hrPerGame: round(recent.hrPerGame, 2),
      warningTrackEvents: recent.warningTrackEvents,
      warningTrackRate: pct(recent.warningTrackRate)
    },
    seasonBaseline: {
      days: season.days,
      games: season.games,
      trackedBattedBalls: season.trackedBattedBalls,
      barrels: season.barrels,
      barrelHomeRuns: season.barrelHomeRuns,
      barrelHrRate: pct(season.barrelHrRate),
      avgBarrelDistance: round(season.avgBarrelDistance, 1),
      homeRuns: season.homeRuns,
      hrPerGame: round(season.hrPerGame, 2),
      warningTrackEvents: season.warningTrackEvents,
      warningTrackRate: pct(season.warningTrackRate)
    },
    comparisons: {
      barrelHrRateLift: round(barrelLift, 3),
      hrPerGameLift: round(hrLift, 3),
      warningTrackLift: round(warningTrackLift, 3),
      avgBarrelDistanceDiff: round(recent.avgBarrelDistance - season.avgBarrelDistance, 1)
    }
  };

  writeJSON(OUT_FILE, output);

  console.log("BALL CARRY INDEX COMPLETE");
  console.log("Date:", output.date);
  console.log("Index:", output.carryIndex);
  console.log("Label:", output.carryLabel);
  console.log("Confidence:", output.confidence);
  console.log("Saved:", OUT_FILE);
}

main();
