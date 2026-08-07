import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const STATE_FILE = path.join(DATA, "mlb_refresh_state.json");
const MAX_FULL_AGE_MS = Number(process.env.MLB_FULL_REFRESH_MINUTES || 55) * 60 * 1000;
const refreshStartedAt = Date.now();

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function run(label, command, env = {}) {
  console.log(`\nRUNNING: ${label}`);
  const result = spawnSync(command, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    shell: true,
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function slateFingerprint(payload) {
  const games = Array.isArray(payload?.games) ? payload.games : [];
  const canonical = games.map(game => ({
    gamePk: Number(game.gamePk),
    gameDate: game.gameDate || null,
    awayTeamId: Number(game.awayTeamId),
    homeTeamId: Number(game.homeTeamId),
    awayProbablePitcherId: Number(game.awayProbablePitcherId) || null,
    homeProbablePitcherId: Number(game.homeProbablePitcherId) || null,
    awayLineupStatus: game.awayLineupStatus || null,
    homeLineupStatus: game.homeLineupStatus || null,
    awayBattingOrder: (game.awayBattingOrder || []).map(row => [Number(row.order), Number(row.playerId)]),
    homeBattingOrder: (game.homeBattingOrder || []).map(row => [Number(row.order), Number(row.playerId)])
  })).sort((a, b) => a.gamePk - b.gamePk);
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

const previousGames = readJson(path.join(DATA, "mlb_games_today.json"), {});
const previousFingerprint = slateFingerprint(previousGames);
const previousState = readJson(STATE_FILE, {});

run("MLB schedule and lineups preflight", "node scripts/mlb/fetch_mlb_today.js");
run("Canonical player ownership preflight", "node scripts/mlb/build_mlb_player_pool.js");

const currentGames = readJson(path.join(DATA, "mlb_games_today.json"), {});
const currentFingerprint = slateFingerprint(currentGames);
const lastFullAt = Date.parse(previousState.lastFullAt || "");
const fullExpired = !Number.isFinite(lastFullAt) || Date.now() - lastFullAt >= MAX_FULL_AGE_MS;
const canonicalInputsChanged = previousFingerprint !== currentFingerprint;
const forced = process.env.MLB_FORCE_FULL_REFRESH === "true";
const profile = forced || fullExpired || canonicalInputsChanged ? "full" : "pulse";

console.log(`\nSMART REFRESH: ${profile.toUpperCase()}`);
console.log(`Canonical inputs changed: ${canonicalInputsChanged}`);
console.log(`Full model expired: ${fullExpired}`);

run(`${profile} MLB refresh`, "node scripts/run_fast_refresh.js", {
  MLB_REFRESH_PROFILE: profile,
  MLB_PREFLIGHT_COMPLETE: "true",
  MLB_REFRESH_STARTED_AT: String(refreshStartedAt)
});

const completedAt = new Date().toISOString();
const nextState = {
  schemaVersion: "1.0",
  updatedAt: completedAt,
  profile,
  fingerprint: currentFingerprint,
  lastFullAt: profile === "full" ? completedAt : previousState.lastFullAt,
  reason: forced ? "forced" : canonicalInputsChanged ? "canonical_inputs_changed" : fullExpired ? "full_refresh_expired" : "live_pulse"
};
const temp = `${STATE_FILE}.tmp`;
fs.writeFileSync(temp, JSON.stringify(nextState, null, 2));
fs.renameSync(temp, STATE_FILE);
console.log(`SMART REFRESH COMPLETE: ${profile}`);
