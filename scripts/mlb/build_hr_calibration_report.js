import fs from "fs";
import path from "path";
import {
  completedResultSlate,
  playableScheduledGames,
  rescheduledGamePks,
  terminalNonPlayedCount,
  terminalNonPlayedGamePks
} from "./result_slate_status.js";

const DATA = path.join(process.cwd(), "website", "data");
const now = new Date();
const nowIso = now.toISOString();
function read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch { return fallback; } }
function arr(v) { return Array.isArray(v) ? v : []; }
function num(v, fallback = null) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function optionalNum(v) { return v === null || v === undefined || v === "" ? null : num(v); }
function round(v, d = 2) { const n = num(v, 0); return Number(n.toFixed(d)); }
function pct(hits, predictions) { return predictions ? round(hits / predictions * 100) : null; }
function key(gamePk, playerId) { return `${Number(gamePk)}|${Number(playerId)}`; }
function etDate(date = now) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function daysAgo(count) { const d = new Date(`${etDate()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - count + 1); return d.toISOString().slice(0, 10); }

const history = read("hr_ai_history.json", { history: {} });
const results = read("hr_results_history.json", { days: [] });
const previousResults = read("mlb_results_previous.json", {});
const receipts = Object.values(history.history || {}).flatMap(arr).filter(row => row?.verifiedPregame === true);
const resultDays = new Map(arr(results.days).map(day => [day.date, day]));
const hrByDay = new Map();
for (const day of arr(results.days)) {
  const map = new Map();
  for (const hr of arr(day.homeRuns)) map.set(key(hr.gamePk, hr.playerId), hr);
  hrByDay.set(day.date, map);
}

const exclusionCounts = { legacyUnverified: 0, missingIdentifiers: 0, afterFirstPitch: 0, incompleteResultDay: 0, missingProbability: 0 };
for (const snapshots of Object.values(history.history || {})) for (const row of arr(snapshots)) if (row?.verifiedPregame !== true) exclusionCounts.legacyUnverified++;

const graded = [];
for (const receipt of receipts) {
  if (!num(receipt.gamePk) || !num(receipt.playerId) || !receipt.slateDate) { exclusionCounts.missingIdentifiers++; continue; }
  const snapshotMs = Date.parse(receipt.snapshotAt || receipt.timestamp || "");
  const startMs = Date.parse(receipt.gameStartTime || "");
  if (!Number.isFinite(snapshotMs) || !Number.isFinite(startMs) || snapshotMs >= startMs) { exclusionCounts.afterFirstPitch++; continue; }
  const day = resultDays.get(receipt.slateDate);
  if (!day || day.status !== "final") { exclusionCounts.incompleteResultDay++; continue; }
  if (num(receipt.probability) === null) { exclusionCounts.missingProbability++; continue; }
  const hr = hrByDay.get(receipt.slateDate)?.get(key(receipt.gamePk, receipt.playerId)) || null;
  graded.push({ ...receipt, hit: Boolean(hr), result: hr });
}

function basic(rows, label = null) {
  const predictions = rows.length;
  const hits = rows.filter(row => row.hit).length;
  const expectedHomeRuns = round(rows.reduce((sum, row) => sum + num(row.probability, 0) / 100, 0));
  return { ...(label ? { label } : {}), predictions, hits, hitRate: pct(hits, predictions), averageProbability: predictions ? round(rows.reduce((s, r) => s + num(r.probability, 0), 0) / predictions) : null, expectedHomeRuns };
}
function group(rows, labelFor) {
  const groups = new Map();
  for (const row of rows) {
    const label = labelFor(row);
    if (!label) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }
  return [...groups.entries()].map(([label, values]) => basic(values, label)).sort((a, b) => b.predictions - a.predictions || a.label.localeCompare(b.label));
}
function probabilityBand(row) {
  const p = num(row.probability);
  if (p === null) return null;
  if (p < 5) return "0–4.9%";
  if (p < 10) return "5–9.9%";
  if (p < 15) return "10–14.9%";
  if (p < 20) return "15–19.9%";
  return "20%+";
}
function weatherBand(row) {
  const score = num(row.weatherScore);
  if (score === null) return null;
  if (score >= 65) return "BOOST";
  if (score <= 35) return "SUPPRESS";
  return "NEUTRAL";
}

function dailyMetric(rows) {
  const metric = basic(rows);
  return {
    predictions: metric.predictions,
    hits: metric.hits,
    hitRate: metric.hitRate,
    expectedHomeRuns: metric.expectedHomeRuns
  };
}

function dailyReport() {
  const reportDate = previousResults?.date || null;
  const totalScheduledGames = num(previousResults?.totalScheduledGames ?? previousResults?.scheduledGames, 0);
  const scheduledGames = playableScheduledGames(previousResults);
  const terminalGamePks = terminalNonPlayedGamePks(previousResults);
  const rescheduledPks = rescheduledGamePks(previousResults);
  const excludedGamePks = new Set([...terminalGamePks, ...rescheduledPks]);
  const actualHomeRuns = arr(previousResults?.homeRuns)
    .filter(row => !rescheduledPks.has(Number(row?.gamePk)));
  const unavailable = reason => ({
    reportDate,
    status: "unavailable",
    reason,
    scheduledGames,
    totalScheduledGames,
    terminalNonPlayedGames: terminalNonPlayedCount(previousResults),
    rescheduledGames: rescheduledPks.size,
    finalGames: num(previousResults?.finalGames, 0),
    skippedGames: num(previousResults?.skippedGames, 0)
  });

  if (!reportDate) return unavailable("missing_result_date");
  if (totalScheduledGames === 0) return { ...unavailable("no_games_scheduled"), status: "no_games_scheduled" };
  if (!completedResultSlate(previousResults)) return unavailable("result_slate_not_final");

  const latestByPlayerGame = new Map();
  for (const receipt of receipts) {
    if (receipt?.slateDate !== reportDate || !num(receipt.gamePk) || !num(receipt.playerId)) continue;
    if (excludedGamePks.has(Number(receipt.gamePk))) continue;
    const snapshotMs = Date.parse(receipt.snapshotAt || receipt.timestamp || "");
    const startMs = Date.parse(receipt.gameStartTime || "");
    if (!Number.isFinite(snapshotMs) || !Number.isFinite(startMs) || snapshotMs >= startMs || num(receipt.probability) === null) continue;
    const receiptKey = key(receipt.gamePk, receipt.playerId);
    const prior = latestByPlayerGame.get(receiptKey);
    const priorMs = Date.parse(prior?.snapshotAt || prior?.timestamp || "");
    if (!prior || snapshotMs > priorMs) latestByPlayerGame.set(receiptKey, receipt);
  }

  if (!latestByPlayerGame.size) return unavailable("no_verified_pregame_receipts");

  const resultMap = new Map(actualHomeRuns.map(row => [key(row.gamePk, row.playerId), row]));
  const rows = [...latestByPlayerGame.values()].map(receipt => {
    const result = resultMap.get(key(receipt.gamePk, receipt.playerId)) || null;
    return { ...receipt, hit: Boolean(result), result };
  });
  const capturedGames = new Set(rows.map(row => Number(row.gamePk))).size;
  const gameCoverage = scheduledGames ? round(capturedGames / scheduledGames * 100, 1) : null;
  if (capturedGames !== scheduledGames) {
    return {
      ...unavailable("incomplete_pregame_game_coverage"),
      archivedPlayers: rows.length,
      capturedGames,
      gameCoverage
    };
  }
  const expectedHomeRuns = round(rows.reduce((sum, row) => sum + num(row.probability, 0) / 100, 0));
  const verifiedCalls = rows.filter(row => row.hit)
    .sort((a, b) => num(a.probabilityRank ?? a.rank, 9999) - num(b.probabilityRank ?? b.rank, 9999) || num(b.probability, 0) - num(a.probability, 0))
    .map(row => ({
      receiptId: row.receiptId,
      gamePk: row.gamePk,
      playerId: row.playerId,
      player: row.player,
      team: row.team,
      opponent: row.opponent || null,
      grade: row.grade || null,
      rank: optionalNum(row.probabilityRank ?? row.rank),
      probability: optionalNum(row.probability),
      bestPitch: row.bestPitch || null,
      distance: optionalNum(row.result?.distance),
      exitVelocity: optionalNum(row.result?.exitVelocity),
      pitchType: row.result?.pitchType || null
    }));
  const notableMisses = rows.filter(row => !row.hit)
    .sort((a, b) => num(b.probability, 0) - num(a.probability, 0) || num(a.probabilityRank ?? a.rank, 9999) - num(b.probabilityRank ?? b.rank, 9999))
    .slice(0, 10)
    .map(row => ({
      receiptId: row.receiptId,
      gamePk: row.gamePk,
      playerId: row.playerId,
      player: row.player,
      team: row.team,
      grade: row.grade || null,
      rank: optionalNum(row.probabilityRank ?? row.rank),
      probability: optionalNum(row.probability)
    }));

  return {
    reportDate,
    status: "verified",
    reason: null,
    scheduledGames,
    totalScheduledGames,
    terminalNonPlayedGames: terminalNonPlayedCount(previousResults),
    rescheduledGames: rescheduledPks.size,
    finalGames: num(previousResults?.finalGames, 0),
    skippedGames: 0,
    archivedPlayers: rows.length,
    capturedGames,
    gameCoverage,
    actualSlateHomeRuns: actualHomeRuns.length,
    expectedHomeRuns,
    actualVsExpected: round(actualHomeRuns.length - expectedHomeRuns),
    fullBoard: dailyMetric(rows),
    top10: dailyMetric(rows.filter(row => num(row.probabilityRank ?? row.rank, 9999) <= 10)),
    top30: dailyMetric(rows.filter(row => num(row.probabilityRank ?? row.rank, 9999) <= 30)),
    verifiedCalls,
    notableMisses,
    verification: {
      join: "reportDate+gamePk+playerId",
      latestSnapshotBeforeFirstPitch: true,
      resultSlateFinal: true,
      source: "mlb_results_previous.json + verified pregame receipts in hr_ai_history.json"
    }
  };
}
function windowReport(label, startDate) {
  const rows = graded.filter(row => row.slateDate >= startDate);
  const days = [...new Set(rows.map(row => row.slateDate))];
  const daily = days.sort().map(date => {
    const dayRows = rows.filter(row => row.slateDate === date);
    const resultDay = resultDays.get(date);
    return { date, ...basic(dayRows), actualSlateHomeRuns: arr(resultDay?.homeRuns).length };
  });
  return {
    label, startDate, endDate: etDate(), ...basic(rows),
    top10: basic(rows.filter(row => num(row.probabilityRank ?? row.rank, 9999) <= 10)),
    top30: basic(rows.filter(row => num(row.probabilityRank ?? row.rank, 9999) <= 30)),
    probabilityBands: group(rows, probabilityBand),
    probabilityTiers: group(rows, row => row.probabilityTier || null),
    tags: group(rows.flatMap(row => arr(row.tags).map(tag => ({ ...row, _group: tag }))), row => row._group),
    signals: group(rows.flatMap(row => arr(row.signals).map(signal => ({ ...row, _group: signal }))), row => row._group),
    pitcherRiskTiers: group(rows, row => row.pitcherRiskTier || null),
    parks: group(rows, row => row.venue || null),
    weather: group(rows, weatherBand),
    handedness: group(rows, row => row.batterHand && row.pitcherHand ? `${row.batterHand} vs ${row.pitcherHand}` : null),
    daily
  };
}

const season = Number(etDate().slice(0, 4));
const last7Days = windowReport("Last 7 days", daysAgo(7));
const last30Days = windowReport("Last 30 days", daysAgo(30));
const seasonWindow = windowReport(`${season} season`, `${season}-01-01`);
const windows = {
  "7d": last7Days,
  "30d": last30Days,
  season: seasonWindow,
  // Preserve the descriptive aliases for existing report consumers.
  last7Days,
  last30Days
};
const seasonRows = graded.filter(row => row.slateDate >= `${season}-01-01`);
const actualHrHits = seasonRows.filter(row => row.hit).map(row => ({ receiptId: row.receiptId, date: row.slateDate, gamePk: row.gamePk, playerId: row.playerId, player: row.player, team: row.team, probability: row.probability, tier: row.probabilityTier, rank: row.probabilityRank, distance: row.result?.distance || "", exitVelocity: row.result?.exitVelocity || "" }));
const verifiedDailyReport = dailyReport();

const report = {
  generatedAt: nowIso,
  schemaVersion: "2.0",
  source: "verified pregame receipts in hr_ai_history.json joined to completed days in hr_results_history.json by date + gamePk + playerId",
  sourceRows: receipts.length,
  resultRows: arr(results.days).reduce((sum, day) => sum + arr(day.homeRuns).length, 0),
  resultsAvailable: arr(results.days).some(day => day.status === "final"),
  verification: { eligibleReceipts: graded.length, exclusionCounts, join: "slateDate+gamePk+playerId", joinKey: ["slateDate", "gamePk", "playerId"], requiresSnapshotBeforeFirstPitch: true, requiresCompletedResultDay: true },
  windows,
  summary: { top10: windows.season.top10, top25: basic(seasonRows.filter(row => num(row.probabilityRank ?? row.rank, 9999) <= 25)), top50: basic(seasonRows.filter(row => num(row.probabilityRank ?? row.rank, 9999) <= 50)), fullBoard: basic(seasonRows), actualHrCount: actualHrHits.length, averageProbabilityOfActualHr: actualHrHits.length ? round(actualHrHits.reduce((s, r) => s + num(r.probability, 0), 0) / actualHrHits.length) : null },
  tiers: windows.season.probabilityTiers,
  dailyReport: verifiedDailyReport,
  actualHrHits,
  longshotHits: actualHrHits.filter(row => row.tier === "LONGSHOT"),
  biggestFalsePositives: seasonRows.filter(row => !row.hit).sort((a, b) => num(b.probability, 0) - num(a.probability, 0)).slice(0, 20).map(row => ({ receiptId: row.receiptId, date: row.slateDate, player: row.player, team: row.team, probability: row.probability, tier: row.probabilityTier, rank: row.probabilityRank })),
  notes: ["Every displayed percentage includes its sample size in the same metric object.", "Legacy snapshots without proof of capture before first pitch are excluded.", "Incomplete result days are excluded rather than treated as misses.", "Weather bands are descriptive analysis of the stored 0–100 weather score: BOOST 65+, SUPPRESS 35 or lower, otherwise NEUTRAL."]
};

fs.writeFileSync(path.join(DATA, "hr_calibration_report.json"), JSON.stringify(report, null, 2));
console.log("HR CALIBRATION REPORT BUILT");
console.log("Verified receipts:", receipts.length);
console.log("Eligible graded receipts:", graded.length);
console.log("Season hits / predictions:", report.summary.fullBoard.hits, "/", report.summary.fullBoard.predictions);
console.log("Daily report:", report.dailyReport.status, report.dailyReport.reportDate || "no date", report.dailyReport.reason || "verified");
console.log("Saved: website/data/hr_calibration_report.json");
