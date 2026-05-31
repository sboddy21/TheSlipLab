import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");

const LIVE_RESULTS_FILE = path.join(DATA_DIR, "mlb_results.json");
const PREVIOUS_RESULTS_FILE = path.join(DATA_DIR, "mlb_results_previous.json");
const HISTORY_FILE = path.join(DATA_DIR, "hr_results_history.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.homeRuns)) return data.homeRuns;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.players)) return data.players;
  return [];
}

function cleanHrRows(rows) {
  return rows
    .filter(r => {
      const event = String(r.event || r.eventType || r.result || r.outcome || "").toLowerCase();
      return event.includes("home") || event.includes("home_run") || Number(r.hr || r.HR || 0) > 0;
    })
    .map(r => ({
      player: r.player || r.batter || r.name || "Unknown Player",
      team: r.team || "",
      opponent: r.opponent || "",
      pitcher: r.pitcher || "",
      inning: r.inning || "",
      game: r.game || "",
      score: r.score || "",
      hr: Number(r.hr || r.HR || 1),
      rbi: Number(r.rbi || 0),
      distance: r.distance || "",
      exitVelocity: r.exitVelocity || "",
      launchAngle: r.launchAngle || "",
      pitchType: r.pitchType || "",
      pitchVelocity: r.pitchVelocity || "",
      description: r.description || "",
      playId: r.playId || "",
      endTime: r.endTime || r.startTime || ""
    }))
    .filter(r => r.player && r.player !== "Unknown Player");
}

function upsertDay(days, date, rows) {
  if (!date) return days;

  const homeRuns = cleanHrRows(rows);
  const dayEntry = {
    date,
    homeRuns,
    total: homeRuns.reduce((sum, r) => sum + Number(r.hr || 0), 0)
  };

  const index = days.findIndex(d => d.date === date);

  if (index >= 0) {
    days[index] = dayEntry;
  } else {
    days.unshift(dayEntry);
  }

  return days;
}

const history = readJSON(HISTORY_FILE, { updatedAt: null, days: [] });
let days = Array.isArray(history.days) ? history.days : [];

const previous = readJSON(PREVIOUS_RESULTS_FILE, null);
if (previous?.date) {
  days = upsertDay(days, previous.date, normalizeRows(previous));
}

const live = readJSON(LIVE_RESULTS_FILE, null);
if (live?.date && Number(live.count || 0) > 0) {
  days = upsertDay(days, live.date, normalizeRows(live));
}

days = days
  .filter(d => d && d.date)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .slice(0, 60);

writeJSON(HISTORY_FILE, {
  updatedAt: new Date().toISOString(),
  source: "mlb_results_previous.json plus live mlb_results.json when populated",
  days
});

console.log("HR RESULTS HISTORY COMPLETE");
console.log("Days:", days.length);
console.log("Latest:", days[0]?.date || "none");
console.log("Latest HR:", days[0]?.total || 0);
console.log("Saved:", HISTORY_FILE);
