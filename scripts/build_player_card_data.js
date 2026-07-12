import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");

const OUT = path.join(DATA, "player_card_data.json");

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function arr(x) {
  if (Array.isArray(x)) return x;
  return x?.allPlayers || x?.players || x?.rows || x?.data || x?.matchups || x?.games || [];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function key(v) {
  return String(v || "").trim().toLowerCase();
}

function calcGames(games) {
  let hr = 0;
  let hits = 0;
  let ab = 0;
  let bb = 0;
  let hbp = 0;
  let sf = 0;
  let tb = 0;
  let rbi = 0;
  let k = 0;
  let runs = 0;

  for (const game of games) {
    const s = game.stat || {};
    hr += num(s.homeRuns);
    hits += num(s.hits);
    ab += num(s.atBats);
    bb += num(s.baseOnBalls);
    hbp += num(s.hitByPitch);
    sf += num(s.sacFlies);
    tb += num(s.totalBases);
    rbi += num(s.rbi);
    k += num(s.strikeOuts);
    runs += num(s.runs);
  }

  const avg = ab ? hits / ab : 0;
  const obpDen = ab + bb + hbp + sf;
  const obp = obpDen ? (hits + bb + hbp) / obpDen : 0;
  const slg = ab ? tb / ab : 0;
  const ops = obp + slg;
  const iso = slg - avg;

  return {
    games: games.length,
    hr,
    hits,
    ab,
    rbi,
    runs,
    k,
    avg: Number(avg.toFixed(3)),
    obp: Number(obp.toFixed(3)),
    slg: Number(slg.toFixed(3)),
    ops: Number(ops.toFixed(3)),
    iso: Number(iso.toFixed(3))
  };
}

async function fetchGameLog(playerId) {
  const season = new Date().getFullYear();
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MLB game log returned ${res.status}`);

      const json = await res.json();
      return (json?.stats?.[0]?.splits || [])
        .filter(row => row?.stat)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    } catch (error) {
      if (attempt === 2) return null;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

function collectPlayers() {
  const map = new Map();
  const playerIdByName = new Map();

  const homeRuns = arr(readJSON(path.join(DATA, "mlb_home_runs.json"), []));
  const decision = arr(readJSON(path.join(DATA, "hr_decision_center.json"), {}));
  const matchups = arr(readJSON(path.join(DATA, "game_pitcher_matchups.json"), {}));

  function add(row, extra = {}) {
    const player = row.player || row.name;
    const playerId = row.playerId || row.mlbId || row.id || playerIdByName.get(key(player));

    if (!player || !playerId) return;

    const id = String(playerId);
    playerIdByName.set(key(player), id);
    map.set(id, {
      ...(map.get(id) || {}),
      ...row,
      ...extra,
      player,
      playerId
    });
  }

  for (const row of homeRuns) add(row);

  for (const game of matchups) {
    for (const row of game.hitters?.away || []) {
      add(row, {
        venue: game.venue,
        gameDate: game.gameDate,
        lineupStatus: game.awayLineupStatus,
        opposingPitcher: row.opposingPitcher || game.homePitcher?.name,
        opposingPitcherHand: game.homePitcher?.side || game.homePitcher?.throws || row.opposingPitcherHand
      });
    }

    for (const row of game.hitters?.home || []) {
      add(row, {
        venue: game.venue,
        gameDate: game.gameDate,
        lineupStatus: game.homeLineupStatus,
        opposingPitcher: row.opposingPitcher || game.awayPitcher?.name,
        opposingPitcherHand: game.awayPitcher?.side || game.awayPitcher?.throws || row.opposingPitcherHand
      });
    }
  }

  // Decision Center is the exclusive owner of matchup confidence, pitch edge,
  // due, zones, and context scores. Apply it last so matchup rows cannot mask
  // those fields, including when Decision Center rows identify players by name.
  for (const row of decision) add(row);

  return [...map.values()];
}

function buildTags(row, last7, last15) {
  const tags = [];
  const h = row.hitterStats || row.stats?.hitter || row.stats || {};

  if (num(row.score || row.hrConfidence) >= 50) tags.push("ELITE MODEL");
  if (num(h.hr) >= 10) tags.push("POWER BAT");
  if (num(h.slg) >= 0.5) tags.push("SLG EDGE");
  if (num(h.ops) >= 0.85) tags.push("OPS EDGE");
  if (last7.hr >= 1) tags.push("RECENT HR");
  if (last7.ops >= 0.85) tags.push("HOT L7");
  if (last15.hr >= 3) tags.push("POWER TREND");
  if (num(row.hotZoneCount) >= 4) tags.push("ZONE POWER");

  if (!tags.length) tags.push("MATCHUP WATCH");

  return tags;
}

function buildSlateSignals(row, last7) {
  const hrConfidence = num(row.hrConfidence ?? row.score);
  const pitchEdge = num(row.pitchEdge);
  const barrelScore = num(row.barrelScore);
  const hardHitScore = num(row.hardHitScore);
  const recentHr = num(last7.hr);
  const signals = [];

  if (hrConfidence >= 52) {
    signals.push({
      key: "hotLook",
      emoji: "🔥",
      label: "Hot Look",
      evidence: { hrConfidence }
    });
  }

  if (recentHr >= 2) {
    signals.push({
      key: "hotLately",
      emoji: "☄️",
      label: "Hot Lately",
      evidence: { last7HomeRuns: recentHr, last7Games: num(last7.games) }
    });
  }

  if (barrelScore >= 80 && hardHitScore >= 75 && recentHr === 0) {
    signals.push({
      key: "due",
      emoji: "🎯",
      label: "Due",
      evidence: { barrelScore, hardHitScore, last7HomeRuns: recentHr, last7Games: num(last7.games) }
    });
  }

  if (hrConfidence >= 42 && hrConfidence < 52 && pitchEdge >= 55 && recentHr === 0) {
    signals.push({
      key: "sleeper",
      emoji: "👀",
      label: "Sleeper Matchup",
      evidence: { hrConfidence, pitchEdge, last7HomeRuns: recentHr, last7Games: num(last7.games) }
    });
  }

  return signals;
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });

  const players = collectPlayers();
  const output = [];

  console.log("PLAYER CARD DATA BUILDER");
  console.log("Players queued:", players.length);

  let i = 0;

  for (const player of players) {
    i++;
    console.log(`[${i}/${players.length}] ${player.player}`);

    const logs = await fetchGameLog(player.playerId);
    if (logs === null) {
      throw new Error(`MLB game log unavailable for ${player.player}; refusing to write incomplete recent-form data`);
    }
    const last7Games = logs.slice(0, 7);
    const last15Games = logs.slice(0, 15);

    const last7 = calcGames(last7Games);
    const last15 = calcGames(last15Games);

    const h = player.hitterStats || player.stats?.hitter || player.stats || {};

    output.push({
      player: player.player,
      playerId: player.playerId,
      team: player.team,
      opponent: player.opponent,
      game: player.game,
      venue: player.venue,
      opposingPitcher: player.opposingPitcher,
      opposingPitcherHand: player.opposingPitcherHand,
      lineupStatus: player.lineupStatus,

      season: {
        hr: num(h.hr),
        hits: num(h.hits),
        doubles: num(h.doubles),
        triples: num(h.triples),
        rbi: num(h.rbi),
        avg: num(h.avg),
        obp: num(h.obp),
        slg: num(h.slg),
        ops: num(h.ops),
        ab: num(h.atBats),
        pa: num(h.plateAppearances),
        k: num(h.strikeOuts)
      },

      last7,
      last15,

      model: {
        score: num(player.score || player.hrConfidence),
        powerScore: num(player.powerScore),
        pitchEdge: num(player.pitchEdge),
        pitcherRisk: num(player.pitcherRisk),
        weather: num(player.weather),
        bullpen: num(player.bullpen),
        due: num(player.due),
        barrelScore: num(player.barrelScore),
        hardHitScore: num(player.hardHitScore),
        zoneOverlap: num(player.zoneOverlap),
        hitterZonePower: num(player.hitterZonePower),
        pitcherLeak: num(player.pitcherLeak),
        hotZoneCount: num(player.hotZoneCount),
        tier: player.tier || player.edge || ""
      },

      slateSignals: buildSlateSignals(player, last7),

      tags: buildTags(player, last7, last15),
      gameLogs: last7Games.map(game => ({
        date: game.date,
        opponent: game.opponent?.name || "",
        ab: num(game.stat?.atBats),
        hits: num(game.stat?.hits),
        hr: num(game.stat?.homeRuns),
        rbi: num(game.stat?.rbi),
        tb: num(game.stat?.totalBases),
        k: num(game.stat?.strikeOuts)
      }))
    });

    await new Promise(resolve => setTimeout(resolve, 120));
  }

  fs.writeFileSync(OUT, JSON.stringify({
    updatedAt: new Date().toISOString(),
    count: output.length,
    players: output
  }, null, 2));

  console.log("PLAYER CARD DATA COMPLETE");
  console.log("Players:", output.length);
  console.log("Saved:", OUT);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
