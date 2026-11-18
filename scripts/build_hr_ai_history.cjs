const fs = require("fs");
const path = require("path");
const { exactGameFromModelSources } = require("./lib/pregame_game_identity.cjs");

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website/data");
const OUT_FILE = path.join(DATA, "hr_ai_history.json");
const MODEL_VERSION = "MLB-HR-1.0";
const candidate = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/mlb/hr-calibration-candidate.json"), "utf8"));
function shadowProbability(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value)) || value < 0 || value > 100) return null;
  const p = Math.max(.0001, Math.min(.9999, Number(value) / 100));
  return 1 / (1 + Math.exp(-(candidate.parameters.intercept + candidate.parameters.slope * Math.log(p / (1 - p)))));
}

function read(name, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); }
  catch { return fallback; }
}
function norm(v) { return String(v || "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""); }
function num(v, fallback = null) { if (v == null || v === "") return fallback; const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function arr(v) { return Array.isArray(v) ? v : []; }
function easternDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function playerName(row) { return row?.player || row?.name || ""; }
function matchPlayer(rows, player, team) {
  const pid = num(player?.playerId);
  return rows.find(row => (pid && num(row?.playerId) === pid) ||
    (norm(playerName(row)) === norm(playerName(player)) && (!team || norm(row?.team) === norm(team)))) || null;
}
function teamMatches(gameTeam, value) {
  if (typeof gameTeam === "string") return norm(gameTeam) === norm(value);
  return norm(gameTeam?.name) === norm(value) || norm(gameTeam?.abbreviation) === norm(value);
}
function findGame(games, player) {
  const candidates = games.filter(game => {
    const team = player?.team;
    const opponent = player?.opponent;
    const teamsMatch = teamMatches(game?.homeTeam, team) || teamMatches(game?.awayTeam, team);
    const opponentMatches = !opponent || teamMatches(game?.homeTeam, opponent) || teamMatches(game?.awayTeam, opponent);
    return teamsMatch && opponentMatches;
  });
  if (candidates.length <= 1) return candidates[0] || null;

  const pitcherName = norm(player?.pitcher);
  if (pitcherName) {
    const pitcherMatch = candidates.find(game => norm(opposingPitcher(game, player?.team).name) === pitcherName);
    if (pitcherMatch) return pitcherMatch;
  }
  return null;
}
function opposingPitcher(game, team) {
  const playerIsHome = teamMatches(game?.homeTeam, team);
  return playerIsHome
    ? { id: num(game?.awayProbablePitcherId), name: game?.awayProbablePitcher || "", hand: game?.awayProbablePitcherHand || "" }
    : { id: num(game?.homeProbablePitcherId), name: game?.homeProbablePitcher || "", hand: game?.homeProbablePitcherHand || "" };
}
function riskTier(value) {
  const risk = num(value);
  if (risk === null) return null;
  if (risk >= 70) return "HIGH";
  if (risk >= 55) return "ELEVATED";
  if (risk >= 35) return "WATCH";
  return "LOW";
}

const now = new Date();
const nowIso = now.toISOString();
const season = Number(easternDate(now).slice(0, 4));
const ai = read("hr_ai_breakdowns.json", { players: {} });
const gamesPayload = read("mlb_games_today.json", { games: [] });
const probabilities = arr(read("hr_probability_tracking.json", { players: [] }).players);
const master = arr(read("mlb_home_runs.json", { players: [] }).players || read("mlb_home_runs.json", []));
const decision = read("hr_decision_center.json", { allPlayers: [] });
const decisionRows = arr(decision.allPlayers);
const vulnerability = arr(read("pitcher_vulnerability.json", { pitchers: [] }).pitchers);
const weatherRows = arr(read("mlb_weather.json", { weather: [] }).weather);
const games = arr(gamesPayload.games);
const market = read("mlb_market_odds.json", { prices: [] });

let history = read("hr_ai_history.json", { updatedAt: nowIso, history: {} });
history.history ||= {};

let captured = 0;
let updated = 0;
let skippedAfterStart = 0;

Object.values(ai.players || {}).forEach((player, index) => {
  const name = playerName(player) || `player_${index}`;
  const playerId = num(player.playerId);
  const probability = matchPlayer(probabilities, player, player.team);
  const masterRow = matchPlayer(master, player, player.team);
  const decisionRow = matchPlayer(decisionRows, player, player.team);
  const game = exactGameFromModelSources(games, player, masterRow, probability, decisionRow)
    || findGame(games, player);
  const gamePk = num(game?.gamePk);
  const gameStartTime = game?.gameDate || game?.gameStartTime || "";
  const startMs = Date.parse(gameStartTime);
  if (!playerId || !gamePk || !Number.isFinite(startMs)) return;

  const receiptId = `${gamesPayload.date || easternDate(now)}|${gamePk}|${playerId}`;
  history.history[name] ||= [];
  const snapshots = history.history[name];
  const existingIndex = snapshots.findIndex(row => row?.verifiedPregame === true && row?.receiptId === receiptId);
  if (now.getTime() >= startMs) {
    if (existingIndex < 0) skippedAfterStart++;
    return;
  }

  const pitcher = opposingPitcher(game, player.team);
  const pitcherRow = vulnerability.find(row => (pitcher.id && num(row?.pitcherId || row?.id) === pitcher.id) || norm(row?.pitcher || row?.name) === norm(pitcher.name)) || null;
  const weather = weatherRows.find(row => norm(row?.venue || row?.venueName) === norm(game?.venue?.name || game?.venue)) || null;
  const tags = [...new Set(arr(decisionRow?.tags).map(String).filter(Boolean))];
  const signals = [...new Set([...arr(player.consensus), ...arr(player.badges), ...arr(decisionRow?.reasons)].map(String).filter(Boolean))];
  const pitcherRisk = num(decisionRow?.pitcherRisk ?? pitcherRow?.vulnerability);

  const receipt = {
    timestamp: nowIso,
    snapshotAt: nowIso,
    firstCapturedAt: existingIndex >= 0 ? snapshots[existingIndex].firstCapturedAt || snapshots[existingIndex].snapshotAt : nowIso,
    verifiedPregame: true,
    verificationStatus: "verified_before_first_pitch",
    receiptId,
    slateDate: gamesPayload.date || easternDate(now),
    season,
    gamePk,
    gameStartTime,
    playerId,
    player: name,
    team: player.team || "",
    opponent: player.opponent || "",
    pitcherId: pitcher.id,
    pitcher: pitcher.name || player.pitcher || "",
    batterHand: masterRow?.batSide || masterRow?.batterHand || "",
    pitcherHand: pitcher.hand || pitcherRow?.side || "",
    venue: game?.venue?.name || game?.venue || "",
    score: num(player.score, 0),
    rank: num(player.rank, index + 1),
    grade: player.grade || "Watch",
    confidence: num(player.confidence, 0),
    probability: num(probability?.realHrProbability),
    probabilityRank: num(probability?.probabilityRank),
    shadowCalibration: { version: candidate.version, frozenAt: candidate.frozenAt,
      probability: shadowProbability(probability?.realHrProbability), status: "research_only" },
    probabilityTier: probability?.probabilityTier || "",
    rawHrEventScore: num(probability?.rawHrEventScore),
    pitcherRisk,
    pitcherRiskTier: riskTier(pitcherRisk),
    parkFactor: num(decisionRow?.parkFactor ?? masterRow?.parkFactor),
    weatherScore: num(decisionRow?.weather ?? masterRow?.weatherScore),
    weather: weather ? {
      temperature: num(weather.temperature ?? weather.temp),
      humidity: num(weather.humidity),
      windSpeed: num(weather.windSpeed),
      windDirection: weather.windDirection || "",
      summary: weather.summary || weather.condition || ""
    } : null,
    reasons: arr(player.reasons).slice(0, 8),
    consensus: arr(player.consensus),
    agreementCount: num(player.agreementCount, 0),
    bestPitch: player.bestPitch || "",
    tags,
    signals,
    headshot: player.headshot || masterRow?.headshot || "",
    marketQuotes: arr(market.prices).filter(quote =>
      Number(quote.gamePk) === gamePk && Number(quote.playerId) === playerId &&
      quote.market === "batter_home_runs" && Number(quote.point) === 0.5 &&
      quote.date === (gamesPayload.date || easternDate(now)) &&
      Number.isFinite(Number(quote.overPriceAmerican)) && Math.abs(Number(quote.overPriceAmerican)) >= 100 &&
      Date.parse(quote.providerLastUpdate) <= now.getTime() &&
      now.getTime() - Date.parse(quote.providerLastUpdate) <= 15 * 60_000
    ).map(quote => ({ quoteId: quote.quoteId, bookmakerKey: quote.bookmakerKey,
      market: quote.market, point: quote.point, odds: quote.overPriceAmerican,
      quotedAt: quote.providerLastUpdate, capturedAt: nowIso })),
    modelVersion: MODEL_VERSION,
    modelCommit: process.env.GITHUB_SHA || null,
    calloutTier: ["A+", "A"].includes(player.grade) ? "core" : player.grade === "B+" && num(player.agreementCount, 0) > 0 ? "secondary" : "watch"
  };

  if (existingIndex >= 0) { snapshots[existingIndex] = receipt; updated++; }
  else { snapshots.push(receipt); captured++; }
});

let verifiedReceiptCount = 0;
let legacySnapshotCount = 0;
for (const [name, snapshots] of Object.entries(history.history)) {
  history.history[name] = arr(snapshots).filter(row => {
    if (row?.verifiedPregame === true) {
      return !row.season || Number(row.season) === season;
    }
    return true;
  }).slice(-500);

  for (const row of history.history[name]) {
    if (row?.verifiedPregame === true) verifiedReceiptCount++;
    else legacySnapshotCount++;
  }
}

history.updatedAt = nowIso;
history.schemaVersion = "2.0";
history.modelVersion = MODEL_VERSION;
const slateDate = gamesPayload.date || easternDate(now);
const analysisGamePks = [...new Set(master.map(row => num(row?.gamePk)).filter(Boolean))].sort((a, b) => a - b);
const capturedAnalysisGamePks = [...new Set(
  Object.values(history.history).flatMap(arr)
    .filter(row => row?.verifiedPregame === true && row?.slateDate === slateDate)
    .map(row => num(row?.gamePk))
    .filter(gamePk => analysisGamePks.includes(gamePk))
)].sort((a, b) => a - b);
const missingAnalysisGamePks = analysisGamePks.filter(gamePk => !capturedAnalysisGamePks.includes(gamePk));
history.verification = {
  verifiedReceiptCount,
  legacySnapshotCount,
  captured,
  updated,
  skippedAfterStart,
  currentSlateAnalysis: {
    slateDate,
    expectedGamePks: analysisGamePks,
    capturedGamePks: capturedAnalysisGamePks,
    missingGamePks: missingAnalysisGamePks,
    complete: missingAnalysisGamePks.length === 0
  }
};
fs.writeFileSync(OUT_FILE, JSON.stringify(history, null, 2));

console.log("AI HISTORY COMPLETE");
console.log("Players:", Object.keys(history.history).length);
console.log("Verified receipts:", verifiedReceiptCount);
console.log("Captured / updated / skipped after start:", captured, updated, skippedAfterStart);
console.log("Current analysis game coverage:", `${capturedAnalysisGamePks.length}/${analysisGamePks.length}`);
if (missingAnalysisGamePks.length) console.log("Missing analysis gamePks:", missingAnalysisGamePks.join(", "));
console.log("Saved:", OUT_FILE);
