import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const HR_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const STATCAST_FILE = path.join(ROOT, "website", "data", "statcast_zones.json");
const MATCHUPS_FILE = path.join(ROOT, "website", "data", "game_pitcher_matchups.json");
const OUT_FILE = path.join(ROOT, "website", "data", "pitcher_attack_zones.json");
const SOURCE = "baseball_savant_hitter_pitcher_zone_overlap";

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing required input ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function n(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, places = 3) {
  const mult = 10 ** places;
  return Math.round(n(value) * mult) / mult;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function norm(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildMatchupMap(matchups) {
  const map = new Map();

  for (const game of matchups.games || []) {
    for (const side of ["away", "home"]) {
      const hitters = game.hitters?.[side] || [];
      const opposingPitcher = side === "away" ? game.homePitcher : game.awayPitcher;
      const pitcherId = opposingPitcher?.id || opposingPitcher?.playerId;
      const pitcher = opposingPitcher?.name || opposingPitcher?.pitcher || "";
      const pending = !pitcherId || !pitcher || pitcher === "TBD" || opposingPitcher?.available === false;
      const matchup = pending
        ? {
            pitcherId: null,
            pitcher: pitcher || "TBD",
            pending: true,
            game: game.matchup || game.game || "Current game"
          }
        : { pitcherId: String(pitcherId), pitcher, pending: false };

      for (const hitter of hitters) {
        if (hitter.playerId) map.set(`id:${hitter.playerId}`, matchup);
        if (hitter.player) map.set(`name:${norm(hitter.player)}`, matchup);
      }
    }
  }

  return map;
}

function xwobaProfile(zones, { requireSamples = true } = {}) {
  const raw = zones?.raw;
  const values = zones?.xwoba;
  if (!Array.isArray(raw) || raw.length !== 25 || !Array.isArray(values) || values.length !== 25) {
    throw new Error("Invalid Statcast xwOBA zone profile");
  }

  let total = 0;
  let samples = 0;

  for (const cell of raw) {
    total += n(cell?.xwobaTotal);
    samples += n(cell?.xwobaCount);
  }

  if (!samples && requireSamples) throw new Error("Statcast pitcher profile has no real xwOBA samples");

  return {
    xwoba: samples ? total / samples : null,
    samples,
    raw,
    values
  };
}

function attackLabel(danger) {
  if (danger === null) return "No Sample";
  if (danger >= 78) return "Red";
  if (danger >= 62) return "Orange";
  if (danger >= 44) return "Yellow";
  return "Blue";
}

function buildZoneGrid(row, hitterCard, pitcherCard) {
  const hitter = xwobaProfile(hitterCard.zones, { requireSamples: false });
  const pitcher = xwobaProfile(pitcherCard.zones, { requireSamples: false });

  const zones = Array.from({ length: 25 }, (_, index) => {
    const hitterSamples = n(hitter.raw[index]?.xwobaCount);
    const pitcherSamples = n(pitcher.raw[index]?.xwobaCount);
    const qualified = hitterSamples > 0 && pitcherSamples > 0;
    const hitterXwoba = qualified ? n(hitter.values[index]) : null;
    const pitcherXwobaAllowed = qualified ? n(pitcher.values[index]) : null;
    const overlapXwoba = qualified ? Math.min(hitterXwoba, pitcherXwobaAllowed) : null;
    const danger = overlapXwoba === null
      ? null
      : round(clamp(overlapXwoba * 100, 0, 100), 2);

    return {
      zone: index + 1,
      danger,
      attack: attackLabel(danger),
      qualified,
      hitterXwoba: hitterXwoba === null ? null : round(hitterXwoba),
      pitcherXwobaAllowed: pitcherXwobaAllowed === null ? null : round(pitcherXwobaAllowed),
      overlapXwoba: overlapXwoba === null ? null : round(overlapXwoba),
      hitterSamples,
      pitcherSamples
    };
  });

  return {
    side: String(row.batSide || hitterCard.batSide || "B").toUpperCase(),
    hitterPower: hitter.xwoba === null ? null : round(clamp(hitter.xwoba * 100, 0, 100), 2),
    pitcherLeak: pitcher.xwoba === null ? null : round(clamp(pitcher.xwoba * 100, 0, 100), 2),
    hitterXwoba: hitter.xwoba === null ? null : round(hitter.xwoba),
    pitcherXwobaAllowed: pitcher.xwoba === null ? null : round(pitcher.xwoba),
    hitterSamples: hitter.samples,
    pitcherSamples: pitcher.samples,
    qualified: hitter.samples > 0,
    qualifiedZones: zones.filter(zone => zone.qualified).length,
    zones
  };
}

function buildPendingPitcherZoneGrid(row, hitterCard) {
  const hitter = xwobaProfile(hitterCard.zones, { requireSamples: false });
  const hitterPower = hitter.xwoba === null ? null : round(clamp(hitter.xwoba * 100, 0, 100), 2);

  return {
    side: String(row.batSide || hitterCard.batSide || "B").toUpperCase(),
    hitterPower,
    pitcherLeak: null,
    hitterXwoba: hitter.xwoba === null ? null : round(hitter.xwoba),
    pitcherXwobaAllowed: null,
    hitterSamples: hitter.samples,
    pitcherSamples: 0,
    qualified: hitter.samples > 0,
    qualifiedZones: 0,
    zoneSignalAvailable: false,
    pendingReason: "opposing_pitcher_not_confirmed",
    zones: Array.from({ length: 25 }, (_, index) => ({
      zone: index + 1,
      danger: null,
      attack: "Pending",
      qualified: false,
      hitterXwoba: null,
      pitcherXwobaAllowed: null,
      overlapXwoba: null,
      hitterSamples: n(hitter.raw[index]?.xwobaCount),
      pitcherSamples: 0
    }))
  };
}

function main() {
  const board = readJson(HR_FILE);
  const statcast = readJson(STATCAST_FILE);
  const matchups = readJson(MATCHUPS_FILE);
  const rows = Array.isArray(board) ? board : [];

  if (!rows.length) {
    if (
      statcast?.availability === "no_games_scheduled" &&
      matchups?.availability === "no_games_scheduled" &&
      statcast?.date === matchups?.date
    ) {
      writeJson(OUT_FILE, {
        updated_at: new Date().toISOString(),
        date: statcast.date,
        availability: "no_games_scheduled",
        source: SOURCE,
        statcastSource: statcast.source,
        note: "No games scheduled; no hitter-versus-pitcher zone overlaps were built.",
        players: {}
      });
      console.log("PITCHER ATTACK ZONES COMPLETE");
      console.log("Availability: no games scheduled");
      console.log("Players: 0");
      console.log(`Saved: ${OUT_FILE}`);
      return;
    }

    throw new Error("mlb_home_runs.json contains no current players");
  }
  if (statcast.source !== "baseball_savant_statcast_pitch_detail_csv") {
    throw new Error(`statcast_zones.json has invalid source ${statcast.source || "missing"}`);
  }
  if (!statcast.date || statcast.date !== matchups.date) {
    throw new Error("Statcast and matchup slate dates do not match");
  }

  const matchupMap = buildMatchupMap(matchups);

  const output = {
    updated_at: new Date().toISOString(),
    date: statcast.date,
    source: SOURCE,
    statcastSource: statcast.source,
    note: "Direct hitter-versus-pitcher xwOBA overlap from real Baseball Savant plate-location samples.",
    players: {}
  };

  for (const row of rows) {
    if (!row.player || !row.playerId) throw new Error("HR board contains a player without a name or MLB ID");

    const matchup = matchupMap.get(`id:${row.playerId}`) || matchupMap.get(`name:${norm(row.player)}`);
    if (!matchup) throw new Error(`No current opposing pitcher mapping for ${row.player}`);

    const hitterCard = statcast.players?.[String(row.playerId)] || statcast.players?.[row.player];
    if (!hitterCard) throw new Error(`No current Statcast hitter zones for ${row.player}`);

    if (matchup.pending) {
      output.players[String(row.playerId)] = {
        player: row.player,
        playerId: row.playerId,
        team: row.team || null,
        opposingPitcher: matchup.pitcher,
        opposingPitcherId: null,
        opposingPitcherPending: true,
        pendingReason: "opposing_pitcher_not_confirmed",
        zones: buildPendingPitcherZoneGrid(row, hitterCard)
      };
      continue;
    }

    const pitcherCard = statcast.pitchers?.[matchup.pitcherId];
    if (!pitcherCard) throw new Error(`No current Statcast pitcher zones for ${matchup.pitcher}`);

    output.players[String(row.playerId)] = {
      player: row.player,
      playerId: row.playerId,
      team: row.team || null,
      opposingPitcher: matchup.pitcher,
      opposingPitcherId: Number(matchup.pitcherId),
      zones: buildZoneGrid(row, hitterCard, pitcherCard)
    };
  }

  if (Object.keys(output.players).length !== rows.length) {
    throw new Error(`Pitcher attack zones produced ${Object.keys(output.players).length} rows for ${rows.length} players`);
  }

  writeJson(OUT_FILE, output);

  console.log("PITCHER ATTACK ZONES COMPLETE");
  console.log(`Players: ${Object.keys(output.players).length}`);
  console.log(`Saved: ${OUT_FILE}`);
}

main();
