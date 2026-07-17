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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.homeRuns)) return data.homeRuns;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.players)) return data.players;
  return [];
}

function normalizeEventRows(data) {
  return Array.isArray(data?.playerEvents) ? data.playerEvents : [];
}

function cleanHrRows(rows) {
  const seen = new Set();

  return rows
    .filter(r => {
      const event = String(r.event || r.eventType || r.result || r.outcome || "").toLowerCase();
      return event.includes("home run") || event.includes("home_run") || Number(r.hr || r.HR || 0) > 0;
    })
    .map(r => ({
      date: r.date || "",
      gamePk: r.gamePk || "",
      player: r.player || r.batter || r.name || "Unknown Player",
      playerId: r.playerId || "",
      team: r.team || "",
      opponent: r.opponent || "",
      pitcher: r.pitcher || "",
      pitcherId: r.pitcherId || "",
      inning: r.inning || "",
      game: r.game || "",
      gameStartTime: r.gameStartTime || "",
      score: r.score || "",
      hr: Number(r.hr || r.HR || 1),
      rbi: Number(r.rbi || 0),
      distance: r.distance || "",
      exitVelocity: r.exitVelocity || "",
      launchAngle: r.launchAngle || "",
      pitchType: r.pitchType || "",
      pitchVelocity: r.pitchVelocity || "",
      description: r.description || "",
      category: "home_run",
      event: r.event || "Home Run",
      eventType: r.eventType || "home_run",
      playId: r.playId || "",
      endTime: r.endTime || r.startTime || ""
    }))
    .filter(r => r.player && r.player !== "Unknown Player")
    .filter(r => {
      const key = [
        r.player,
        r.team,
        r.pitcher,
        r.inning,
        r.description,
        r.endTime
      ].join("|");

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function cleanEventRows(rows) {
  const allowed = new Set(["home_run", "sac_fly", "flyout", "lineout", "pop_out"]);
  const seen = new Set();

  return rows
    .filter(row => allowed.has(String(row?.category || "")))
    .map(row => ({
      date: row.date || "",
      gamePk: row.gamePk || "",
      playerId: row.playerId || "",
      player: row.player || row.batter || "",
      team: row.team || "",
      opponent: row.opponent || "",
      pitcher: row.pitcher || "",
      pitcherId: row.pitcherId || "",
      inning: row.inning || "",
      game: row.game || "",
      event: row.event || "",
      eventType: row.eventType || "",
      category: row.category,
      isCloseCall: row.isCloseCall === true,
      rbi: Number(row.rbi || 0),
      distance: row.distance ?? "",
      exitVelocity: row.exitVelocity ?? "",
      launchAngle: row.launchAngle ?? "",
      pitchType: row.pitchType || "",
      pitchVelocity: row.pitchVelocity ?? "",
      description: row.description || "",
      playId: row.playId ?? "",
      endTime: row.endTime || row.startTime || ""
    }))
    .filter(row => row.player)
    .filter(row => {
      const key = [row.gamePk, row.playId, row.playerId, row.category, row.endTime].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function upsertDay(days, date, rawRows, rawEventRows) {
  if (!date) return days;

  const homeRuns = cleanHrRows(rawRows);
  const playerEvents = cleanEventRows(rawEventRows);
  if (!homeRuns.length && !playerEvents.length) return days;

  const dayEntry = {
    date,
    homeRuns,
    playerEvents,
    total: homeRuns.reduce((sum, r) => sum + Number(r.hr || 0), 0)
  };

  const index = days.findIndex(d => d.date === date);

  if (index >= 0) {
    days[index] = dayEntry;
  } else {
    days.push(dayEntry);
  }

  return days;
}

const history = readJSON(HISTORY_FILE, { updatedAt: null, days: [] });
let days = Array.isArray(history.days) ? history.days : [];

const previous = readJSON(PREVIOUS_RESULTS_FILE, null);
if (previous?.date) {
  days = upsertDay(days, previous.date, normalizeRows(previous), normalizeEventRows(previous));
}

const live = readJSON(LIVE_RESULTS_FILE, null);
if (live?.date) {
  days = upsertDay(days, live.date, normalizeRows(live), normalizeEventRows(live));
}

days = days
  .filter(d => d && d.date && (Array.isArray(d.homeRuns) || Array.isArray(d.playerEvents)))
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .slice(0, 60);

writeJSON(HISTORY_FILE, {
  updatedAt: new Date().toISOString(),
  source: "live mlb_results.json plus previous day mlb_results_previous.json",
  days
});

console.log("HR RESULTS HISTORY COMPLETE");
console.log("Days:", days.length);
console.log("Latest:", days[0]?.date || "none");
console.log("Latest HR:", days[0]?.total || 0);
console.log("Saved:", HISTORY_FILE);
