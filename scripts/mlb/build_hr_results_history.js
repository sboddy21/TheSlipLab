import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const RESULTS_FILE = path.join(DATA_DIR, "mlb_results.json");
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

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.homeRuns)) return data.homeRuns;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.players)) return data.players;
  return [];
}

const date = todayET();
const results = readJSON(RESULTS_FILE, {});
const rows = normalizeRows(results);

const homeRuns = rows
  .filter(r => {
    const hr = Number(r.hr || r.HR || r.homeRuns || r.home_runs || r.homeRunCount || 0);
    const result = String(r.result || r.outcome || r.event || "").toLowerCase();
    return hr > 0 || result.includes("home run") || result.includes("homer");
  })
  .map(r => ({
    player: r.player || r.name || r.batter || "Unknown Player",
    team: r.team || r.playerTeam || r.battingTeam || "",
    opponent: r.opponent || r.opp || "",
    hr: Number(r.hr || r.HR || r.homeRuns || r.home_runs || 1),
    game: r.game || r.matchup || ""
  }))
  .filter(r => r.player && r.player !== "Unknown Player");

const history = readJSON(HISTORY_FILE, { updatedAt: null, days: [] });
const days = Array.isArray(history.days) ? history.days : [];

const dayEntry = {
  date,
  homeRuns,
  total: homeRuns.reduce((sum, r) => sum + Number(r.hr || 0), 0)
};

const existingIndex = days.findIndex(d => d.date === date);

if (existingIndex >= 0) {
  days[existingIndex] = dayEntry;
} else {
  days.unshift(dayEntry);
}

const cleaned = days
  .filter(d => d && d.date)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .slice(0, 45);

writeJSON(HISTORY_FILE, {
  updatedAt: new Date().toISOString(),
  days: cleaned
});

console.log("HR RESULTS HISTORY COMPLETE");
console.log("Date:", date);
console.log("Home run hitters:", homeRuns.length);
console.log("Saved:", HISTORY_FILE);
