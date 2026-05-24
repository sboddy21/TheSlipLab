import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const DECISION_FILE = path.join(DATA_DIR, "hr_decision_center.json");
const OUT_FILE = path.join(DATA_DIR, "player_spray_charts.json");

const SEASON = new Date().getFullYear();
const START_DATE = `${SEASON}-03-01`;
const END_DATE = `${SEASON}-11-30`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function csvSplit(line) {
  const out = [];
  let cur = "";
  let quote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      quote = !quote;
    } else if (ch === "," && !quote) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const headers = csvSplit(lines[0]).map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = csvSplit(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function eventType(eventName, distance) {
  const e = clean(eventName).toLowerCase();

  if (e === "home_run") return "HR";
  if (e === "double") return "2B";
  if (e === "triple") return "3B";
  if (e === "single") return "1B";
  if (Number(distance || 0) >= 360) return "Near HR";

  return "BIP";
}

function isUsefulBattedBall(row) {
  const x = num(row.hc_x);
  const y = num(row.hc_y);
  const event = clean(row.events).toLowerCase();

  if (x === null || y === null) return false;
  if (!event) return false;

  return [
    "home_run",
    "double",
    "triple",
    "single",
    "field_out",
    "force_out",
    "grounded_into_double_play",
    "fielders_choice_out",
    "sac_fly",
    "lineout",
    "flyout",
    "groundout",
    "popup"
  ].includes(event);
}

function savantUrl(playerId) {
  const params = new URLSearchParams();

  params.set("all", "true");
  params.set("hfGT", "R|");
  params.set("hfSea", `${SEASON}|`);
  params.set("player_type", "batter");
  params.set("game_date_gt", START_DATE);
  params.set("game_date_lt", END_DATE);
  params.append("batters_lookup[]", String(playerId));
  params.set("type", "details");
  params.set("sort_col", "game_date");
  params.set("sort_order", "desc");
  params.set("min_pitches", "0");
  params.set("min_results", "0");

  return `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;
}

async function fetchPlayer(player) {
  const playerId = player.playerId || player.mlbId || player.id;

  if (!playerId) {
    return {
      player: player.player,
      playerId: null,
      team: player.team,
      points: [],
      summary: {},
      error: "missing_player_id"
    };
  }

  const res = await fetch(savantUrl(playerId), {
    headers: {
      "user-agent": "TheSlipLab/1.0",
      "accept": "text/csv"
    }
  });

  if (!res.ok) {
    throw new Error(`Baseball Savant failed ${res.status}`);
  }

  const text = await res.text();
  const rows = parseCsv(text);

  const points = rows
    .filter(isUsefulBattedBall)
    .map(row => {
      const distance = num(row.hit_distance_sc);
      const type = eventType(row.events, distance);

      return {
        type,
        event: clean(row.events),
        date: clean(row.game_date),
        opponent: clean(row.home_team) && clean(row.away_team) ? `${clean(row.away_team)} @ ${clean(row.home_team)}` : "",
        pitcher: clean(row.pitcher),
        pitchType: clean(row.pitch_type),
        pitchName: clean(row.pitch_name),
        x: num(row.hc_x),
        y: num(row.hc_y),
        launchSpeed: num(row.launch_speed),
        launchAngle: num(row.launch_angle),
        distance,
        inning: num(row.inning),
        description: clean(row.des)
      };
    });

  const summary = {
    total: points.length,
    HR: points.filter(p => p.type === "HR").length,
    "Near HR": points.filter(p => p.type === "Near HR").length,
    "2B": points.filter(p => p.type === "2B").length,
    "3B": points.filter(p => p.type === "3B").length,
    "1B": points.filter(p => p.type === "1B").length,
    BIP: points.filter(p => p.type === "BIP").length
  };

  return {
    player: player.player,
    playerId,
    team: player.team,
    updatedAt: new Date().toISOString(),
    points,
    summary
  };
}

async function main() {
  if (!fs.existsSync(DECISION_FILE)) {
    throw new Error(`Missing ${DECISION_FILE}`);
  }

  const decision = JSON.parse(fs.readFileSync(DECISION_FILE, "utf8"));

  const players = (decision.allPlayers || [])
    .filter(p => p.player)
    .filter((p, i, arr) => arr.findIndex(x => x.player === p.player) === i)
    .slice(0, 120);

  const out = {
    updatedAt: new Date().toISOString(),
    source: "baseballsavant_statcast_search_csv",
    season: SEASON,
    players: {}
  };

  console.log("BUILDING PLAYER SPRAY CHARTS");
  console.log("Players:", players.length);

  for (const player of players) {
    try {
      const data = await fetchPlayer(player);
      out.players[player.player] = data;
      console.log("OK", player.player, data.points.length, "points");
      await sleep(350);
    } catch (err) {
      out.players[player.player] = {
        player: player.player,
        playerId: player.playerId || null,
        team: player.team,
        points: [],
        summary: {},
        error: err.message
      };
      console.log("SKIP", player.player, err.message);
      await sleep(700);
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log("SAVED:", OUT_FILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
