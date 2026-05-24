import fs from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "website", "data");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(
    path.join(DATA, file),
    JSON.stringify(data, null, 2)
  );
}

function rows(data) {
  if (Array.isArray(data)) return data;

  if (!data || typeof data !== "object") return [];

  if (Array.isArray(data.allPlayers)) return data.allPlayers;
  if (Array.isArray(data.players)) return data.players;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.data)) return data.data;

  return [];
}

function normalize(name="") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildIndex(data) {
  const map = new Map();

  const r = rows(data);

  for (const item of r) {
    if (!item) continue;

    const player =
      item.player ||
      item.name ||
      item.hitter ||
      item.batter;

    if (player) {
      map.set(normalize(player), item);
    }

    if (item.playerId) {
      map.set(String(item.playerId), item);
    }
  }

  return map;
}

function lookup(map, player, playerId) {
  return (
    map.get(String(playerId || "")) ||
    map.get(normalize(player || "")) ||
    {}
  );
}

const hrBoard = rows(readJSON("mlb_home_runs.json", []));

const decisionMap = buildIndex(
  readJSON("hr_decision_center.json", [])
);

const advancedMap = buildIndex(
  readJSON("advanced_player_intelligence.json", [])
);

const zonesMap = buildIndex(
  readJSON("statcast_zones.json", [])
);

const pitchMap = buildIndex(
  readJSON("pitch_type_damage.json", [])
);

const sprayCharts = readJSON(
  "player_spray_charts.json",
  {}
);

const gameLogs = readJSON(
  "player_game_logs.json",
  {}
);

const profiles = [];

for (const player of hrBoard) {
  const d = lookup(
    decisionMap,
    player.player,
    player.playerId
  );

  const a = lookup(
    advancedMap,
    player.player,
    player.playerId
  );

  const z = lookup(
    zonesMap,
    player.player,
    player.playerId
  );

  const p = lookup(
    pitchMap,
    player.player,
    player.playerId
  );

  const spray =
    sprayCharts[player.player] || {};

  const logs =
    gameLogs[player.player] || {};

  const hitter =
    player.stats?.hitter ||
    a.hitterStats ||
    {};

  const pitcher =
    player.stats?.pitcher ||
    a.pitcherStats ||
    {};

  profiles.push({
    player: player.player,
    playerId: player.playerId || null,
    team: player.team || "",
    opponent: player.opponent || "",
    game: player.game || "",
    venue: player.venue || "",
    pitcher:
      player.opposingPitcher ||
      a.pitcher ||
      "",

    batSide:
      player.batSideDescription ||
      player.batSide ||
      "",

    score:
      player.score ??
      a.overallPlayerScore ??
      d.hrConfidence ??
      0,

    odds: player.odds || "N/A",

    edge: player.edge || "",

    summary: {
      hrConfidence:
        d.hrConfidence ??
        player.score ??
        0,

      powerScore:
        d.powerScore ??
        a.powerFormScore ??
        0,

      weather:
        d.weather ?? 0,

      bullpen:
        d.bullpen ?? 0,

      due:
        d.due ?? 0,

      tier:
        d.tier ||
        a.grade ||
        "Watchlist",

      tags:
        d.tags ||
        a.profileTags ||
        []
    },

    hitterStats: {
      hr: hitter.hr ?? 0,
      hits: hitter.hits ?? 0,
      doubles: hitter.doubles ?? 0,
      triples: hitter.triples ?? 0,
      rbi: hitter.rbi ?? 0,
      avg: hitter.avg ?? 0,
      obp: hitter.obp ?? 0,
      slg: hitter.slg ?? 0,
      ops: hitter.ops ?? 0
    },

    pitcherStats: {
      era: pitcher.era ?? 0,
      whip: pitcher.whip ?? 0,
      strikeOuts:
        pitcher.strikeOuts ?? 0,
      inningsPitched:
        pitcher.inningsPitched ?? 0
    },

    zones: {
      zoneOverlap:
        d.zoneOverlap ??
        z.zoneOverlap ??
        0,

      hitterZonePower:
        d.hitterZonePower ??
        z.hitterZonePower ??
        0,

      hotZoneCount:
        d.hotZoneCount ??
        z.hotZoneCount ??
        0,

      zoneCells:
        d.zoneCells ||
        z.zoneCells ||
        []
    },

    pitchMatchup: {
      bestPitch:
        d.bestPitch ||
        a.bestPitchMatchup ||
        "Standard Matchup",

      pitchDamageScore:
        a.pitchDamageScore ??
        p.pitchDamageScore ??
        0
    },

    sprayChart: {
      points:
        spray.points || []
    },

    gameLogs: {
      logs:
        logs.logs ||
        logs.games ||
        []
    },

    reasons:
      d.reasons ||
      a.notes ||
      [],

    completeProfile: true
  });
}

writeJSON(
  "player_card_profiles.json",
  {
    updatedAt:
      new Date().toISOString(),
    count: profiles.length,
    players: profiles
  }
);

console.log("");
console.log(
  "PLAYER CARD PROFILES COMPLETE"
);
console.log(
  "Profiles:",
  profiles.length
);
console.log(
  "Saved: website/data/player_card_profiles.json"
);
