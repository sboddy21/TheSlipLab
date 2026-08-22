import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "../../website/data");
const OUTPUT = path.join(DATA, "live_change_alerts.json");
const SCHEMA_VERSION = "1.0";
const MAX_ALERTS = 250;
const MAX_MODEL_AGE_MS = 70 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 2000;

const SOURCES = {
  schedule: "mlb_games_today.json",
  pool: "mlb_player_pool.json",
  matchups: "game_pitcher_matchups.json",
  cards: "player_card_data.json",
  probabilities: "hr_probability_tracking.json",
  vulnerability: "pitcher_vulnerability.json"
};

const LIVE_SOURCES = new Set([SOURCES.pool, SOURCES.cards]);
const MODEL_SOURCES = new Set([SOURCES.matchups, SOURCES.probabilities, SOURCES.vulnerability]);

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
}

function readPrevious() {
  if (!fs.existsSync(OUTPUT)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
    return payload?.schemaVersion === SCHEMA_VERSION ? payload : null;
  } catch {
    return null;
  }
}

function timestamp(payload, fields) {
  const field = fields.find(name => payload?.[name]);
  const value = field ? payload[field] : null;
  const parsed = Date.parse(value);
  if (!field || !Number.isFinite(parsed)) throw new Error(`Missing or invalid ${fields.join("/")} timestamp`);
  return { value, parsed };
}

export function validateSourceFreshness({ scheduleTime, sourceTimes, now = Date.now() }) {
  if (!Number.isFinite(scheduleTime)) throw new Error("mlb_games_today.json has an invalid refresh timestamp");
  for (const [file, value] of Object.entries(sourceTimes)) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(`${file} has an invalid refresh timestamp`);
    if (parsed > now + CLOCK_TOLERANCE_MS) throw new Error(`${file} has a future refresh timestamp`);
    if (LIVE_SOURCES.has(file) && parsed < scheduleTime - CLOCK_TOLERANCE_MS) {
      throw new Error(`${file} predates the current live refresh`);
    }
    if (MODEL_SOURCES.has(file) && now - parsed > MAX_MODEL_AGE_MS) {
      throw new Error(`${file} exceeded its model refresh window`);
    }
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function playerKey(player, team) {
  return `${normalize(player)}|${normalize(team)}`;
}

function statusIsConfirmed(row) {
  if (row?.confirmedLineup === true) return true;
  return /confirmed/i.test(String(row?.lineupStatus || ""));
}

function statusIsRemoved(row) {
  return /not.?in.?lineup|out|bench/i.test(String(row?.lineupStatus || ""));
}

function alertId(parts) {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
}

function makeAlert({ date, now, kind, severity, entityType, entity, title, message, previous, current, sourceFiles }) {
  return {
    id: alertId([date, kind, entityType, entity.id, JSON.stringify(previous), JSON.stringify(current)]),
    createdAt: now,
    date,
    sport: "MLB",
    kind,
    severity,
    entityType,
    entityId: String(entity.id),
    entityName: entity.name,
    team: entity.team || null,
    gamePk: entity.gamePk || null,
    title,
    message,
    previous,
    current,
    sourceFiles
  };
}

export function detectChanges(previous, current, date, now) {
  const alerts = [];
  const oldPlayers = previous?.players || {};
  const oldPitchers = previous?.pitchers || {};

  for (const [id, player] of Object.entries(current.players || {})) {
    const prior = oldPlayers[id];
    if (!prior) continue;

    if (!statusIsConfirmed(prior) && statusIsConfirmed(player)) {
      alerts.push(makeAlert({
        date, now, kind: "lineup_confirmed", severity: "high", entityType: "player", entity: player,
        title: `${player.name} confirmed in the lineup`,
        message: player.lineupSpot ? `${player.name} is confirmed batting ${player.lineupSpot}.` : `${player.name} is now confirmed in today's lineup.`,
        previous: { lineupStatus: prior.lineupStatus, lineupSpot: prior.lineupSpot },
        current: { lineupStatus: player.lineupStatus, lineupSpot: player.lineupSpot },
        sourceFiles: [SOURCES.pool]
      }));
    }

    if (statusIsConfirmed(prior) && statusIsRemoved(player)) {
      alerts.push(makeAlert({
        date, now, kind: "lineup_removed", severity: "high", entityType: "player", entity: player,
        title: `${player.name} removed from the confirmed lineup`,
        message: `${player.name}'s verified lineup status changed to ${player.lineupStatus}.`,
        previous: { lineupStatus: prior.lineupStatus, lineupSpot: prior.lineupSpot },
        current: { lineupStatus: player.lineupStatus, lineupSpot: player.lineupSpot },
        sourceFiles: [SOURCES.pool]
      }));
    }

    if (prior.opposingPitcherId && player.opposingPitcherId && String(prior.opposingPitcherId) !== String(player.opposingPitcherId)) {
      alerts.push(makeAlert({
        date, now, kind: "opposing_pitcher_changed", severity: "high", entityType: "player", entity: player,
        title: `Pitching matchup changed for ${player.name}`,
        message: `${player.name}'s listed opponent changed from ${prior.opposingPitcher || "the prior starter"} to ${player.opposingPitcher || "a new starter"}.`,
        previous: { pitcherId: prior.opposingPitcherId, pitcher: prior.opposingPitcher },
        current: { pitcherId: player.opposingPitcherId, pitcher: player.opposingPitcher },
        sourceFiles: [SOURCES.pool, SOURCES.matchups]
      }));
    }

    if (prior.probability !== null && player.probability !== null && Math.abs(player.probability - prior.probability) >= 5) {
      const direction = player.probability > prior.probability ? "rose" : "fell";
      alerts.push(makeAlert({
        date, now, kind: "probability_move", severity: "medium", entityType: "player", entity: player,
        title: `${player.name}'s HR probability ${direction}`,
        message: `Tracked HR probability ${direction} from ${prior.probability}% to ${player.probability}%.`,
        previous: { probability: prior.probability }, current: { probability: player.probability },
        sourceFiles: [SOURCES.probabilities]
      }));
    }

    if (prior.modelScore !== null && player.modelScore !== null && Math.abs(player.modelScore - prior.modelScore) >= 8) {
      const direction = player.modelScore > prior.modelScore ? "rose" : "fell";
      alerts.push(makeAlert({
        date, now, kind: "model_score_move", severity: "medium", entityType: "player", entity: player,
        title: `${player.name}'s model score ${direction}`,
        message: `The live model score ${direction} from ${prior.modelScore} to ${player.modelScore}.`,
        previous: { modelScore: prior.modelScore }, current: { modelScore: player.modelScore },
        sourceFiles: [SOURCES.cards]
      }));
    }

    const oldSignals = new Set(Array.isArray(prior.signals) ? prior.signals : []);
    const newSignals = new Set(Array.isArray(player.signals) ? player.signals : []);
    const added = [...newSignals].filter(signal => !oldSignals.has(signal));
    const removed = [...oldSignals].filter(signal => !newSignals.has(signal));
    if (added.length || removed.length) {
      alerts.push(makeAlert({
        date, now, kind: "signal_change", severity: "medium", entityType: "player", entity: player,
        title: `${player.name}'s verified signals changed`,
        message: [added.length ? `Added: ${added.join(", ")}.` : "", removed.length ? `Removed: ${removed.join(", ")}.` : ""].filter(Boolean).join(" "),
        previous: { signals: [...oldSignals] }, current: { signals: [...newSignals] },
        sourceFiles: [SOURCES.cards]
      }));
    }
  }

  for (const [id, pitcher] of Object.entries(current.pitchers || {})) {
    const prior = oldPitchers[id];
    if (!prior || prior.vulnerability === null || pitcher.vulnerability === null) continue;
    if (Math.abs(pitcher.vulnerability - prior.vulnerability) < 10) continue;
    const direction = pitcher.vulnerability > prior.vulnerability ? "rose" : "fell";
    alerts.push(makeAlert({
      date, now, kind: "pitcher_vulnerability_move", severity: "medium", entityType: "pitcher", entity: pitcher,
      title: `${pitcher.name}'s vulnerability ${direction}`,
      message: `The verified pitcher vulnerability score ${direction} from ${prior.vulnerability} to ${pitcher.vulnerability}.`,
      previous: { vulnerability: prior.vulnerability }, current: { vulnerability: pitcher.vulnerability },
      sourceFiles: [SOURCES.vulnerability]
    }));
  }

  return alerts;
}

function buildSnapshot(payloads) {
  const probabilityMap = new Map((payloads.probabilities.players || []).map(row => [playerKey(row.player, row.team), numberOrNull(row.realHrProbability)]));
  const cardById = new Map((payloads.cards.players || []).map(row => [String(row.playerId || ""), row]));
  const gameByPitcher = new Map();
  for (const game of payloads.matchups.games || []) {
    const pitchers = [
      game.awayPitcher,
      game.homePitcher,
      game.awayProbablePitcherId ? { id: game.awayProbablePitcherId } : null,
      game.homeProbablePitcherId ? { id: game.homeProbablePitcherId } : null
    ];
    for (const pitcher of pitchers) {
      if (pitcher?.id) gameByPitcher.set(String(pitcher.id), game.gamePk || null);
    }
  }

  const players = {};
  for (const row of payloads.pool.players || []) {
    if (!row.playerId || !row.player) continue;
    const id = String(row.playerId);
    const card = cardById.get(id) || {};
    players[id] = {
      id,
      name: row.player,
      team: row.team || null,
      opponent: row.opponent || null,
      gamePk: row.gamePk || null,
      lineupStatus: row.lineupStatus || null,
      confirmedLineup: row.confirmedLineup === true,
      lineupSpot: numberOrNull(row.lineupSpot),
      opposingPitcherId: row.opposingProbablePitcherId ? String(row.opposingProbablePitcherId) : null,
      opposingPitcher: row.opposingProbablePitcher || null,
      probability: probabilityMap.get(playerKey(row.player, row.team)) ?? null,
      modelScore: numberOrNull(card?.model?.score),
      signals: (card.slateSignals || []).map(signal => String(signal?.key || "")).filter(Boolean).sort()
    };
  }

  const pitchers = {};
  for (const row of payloads.vulnerability.pitchers || []) {
    const idValue = row.id || row.pitcherId;
    if (!idValue || !(row.pitcher || row.name)) continue;
    const id = String(idValue);
    pitchers[id] = {
      id,
      name: row.pitcher || row.name,
      team: row.team || null,
      opponent: row.opponent || null,
      gamePk: gameByPitcher.get(id) || null,
      vulnerability: numberOrNull(row.vulnerability)
    };
  }
  return { players, pitchers };
}

function validateOutput(payload) {
  if (payload.schemaVersion !== SCHEMA_VERSION || !payload.date || !Number.isFinite(Date.parse(payload.generatedAt))) throw new Error("Invalid live alert metadata");
  if (!Array.isArray(payload.alerts) || !payload.snapshot?.players || !payload.snapshot?.pitchers) throw new Error("Invalid live alert collections");
  for (const alert of payload.alerts) {
    if (!alert.id || !alert.kind || !alert.entityId || !alert.entityName || !Number.isFinite(Date.parse(alert.createdAt))) throw new Error("Invalid live alert row");
  }
}

function main() {
  const payloads = {
    schedule: read(SOURCES.schedule), pool: read(SOURCES.pool), matchups: read(SOURCES.matchups),
    cards: read(SOURCES.cards), probabilities: read(SOURCES.probabilities), vulnerability: read(SOURCES.vulnerability)
  };
  const date = payloads.schedule.date;
  if (!date) throw new Error("mlb_games_today.json is missing date");
  for (const [label, payload] of [["player pool", payloads.pool], ["pitcher matchups", payloads.matchups], ["pitcher vulnerability", payloads.vulnerability]]) {
    if (payload.date !== date) throw new Error(`${label} is for ${payload.date || "an unknown date"}, expected ${date}`);
  }

  const scheduleTime = timestamp(payloads.schedule, ["updatedAt", "fetchedAt"]).parsed;
  const sourceTimes = {
    [SOURCES.schedule]: timestamp(payloads.schedule, ["updatedAt", "fetchedAt"]).value,
    [SOURCES.pool]: timestamp(payloads.pool, ["updatedAt", "fetchedAt"]).value,
    [SOURCES.matchups]: timestamp(payloads.matchups, ["updatedAt"]).value,
    [SOURCES.cards]: timestamp(payloads.cards, ["updatedAt"]).value,
    [SOURCES.probabilities]: timestamp(payloads.probabilities, ["generatedAt"]).value,
    [SOURCES.vulnerability]: timestamp(payloads.vulnerability, ["updatedAt"]).value
  };
  validateSourceFreshness({ scheduleTime, sourceTimes });

  const previous = readPrevious();
  const now = new Date().toISOString();
  const noGames = Array.isArray(payloads.schedule.games) && payloads.schedule.games.length === 0;
  const snapshot = noGames ? { players: {}, pitchers: {} } : buildSnapshot(payloads);
  const sameSlate = previous?.date === date;
  const newlyDetected = sameSlate && !noGames ? detectChanges(previous.snapshot, snapshot, date, now) : [];
  const existing = sameSlate && Array.isArray(previous.alerts) ? previous.alerts : [];
  const byId = new Map([...existing, ...newlyDetected].map(alert => [alert.id, alert]));
  const alerts = [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, MAX_ALERTS);
  const status = noGames ? "no_games_scheduled" : sameSlate ? "ready" : "baseline_established";
  const output = { schemaVersion: SCHEMA_VERSION, generatedAt: now, date, status, sources: sourceTimes, alerts, snapshot };
  validateOutput(output);
  const temporary = `${OUTPUT}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(output, null, 2)}\n`);
  fs.renameSync(temporary, OUTPUT);
  console.log("LIVE CHANGE ALERTS COMPLETE");
  console.log("Date:", date);
  console.log("Status:", status);
  console.log("New alerts:", newlyDetected.length);
  console.log("Saved alerts:", alerts.length);
  console.log("Saved:", OUTPUT);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
