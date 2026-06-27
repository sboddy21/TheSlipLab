import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const POOL_FILE = path.join(DATA_DIR, "mlb_player_pool.json");
const POWER_PROFILE_FILE = path.join(DATA_DIR, "hr_power_profiles.json");

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

function write(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

function arr(x) {
  if (Array.isArray(x)) return x;
  return x?.allPlayers || x?.players || x?.rows || x?.data || [];
}

function num(v, fallback = 0) {
  const n = Number(String(v ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v) {
  return Math.max(0, Math.min(100, v));
}

function scale(v, min, max) {
  return clamp(((num(v) - min) / (max - min)) * 100);
}

function key(v) {
  return String(v || "").toLowerCase().trim();
}

function round1(v) {
  return Math.round(num(v) * 10) / 10;
}

function stat(row, k, fallback = 0) {
  return num(row?.stats?.hitter?.[k] ?? row?.hitterStats?.[k] ?? row?.[k], fallback);
}

function bestZone(row, names) {
  let best = 0;

  for (const name of names) {
    const values = row?.[name];
    if (!Array.isArray(values)) continue;

    for (const value of values) {
      best = Math.max(best, num(value?.value ?? value));
    }
  }

  return best;
}


async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return res.json();
}

async function getPlayerBio(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}`;
  const data = await getJson(url);
  const person = data?.people?.[0] || {};

  return {
    batSide: person?.batSide?.code || null,
    batSideDescription: person?.batSide?.description || null,
    pitchHand: person?.pitchHand?.code || null,
    pitchHandDescription: person?.pitchHand?.description || null
  };
}

async function getHitterStats(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=hitting`;
  const data = await getJson(url);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};

  return {
    hr: num(stat.homeRuns),
    hits: num(stat.hits),
    doubles: num(stat.doubles),
    triples: num(stat.triples),
    rbi: num(stat.rbi),
    avg: num(stat.avg),
    obp: num(stat.obp),
    slg: num(stat.slg),
    ops: num(stat.ops),
    atBats: num(stat.atBats),
    plateAppearances: num(stat.plateAppearances),
    strikeOuts: num(stat.strikeOuts)
  };
}

async function getPitcherStats(playerId) {
  if (!playerId) return null;

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching`;
  const data = await getJson(url);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};

  return {
    era: num(stat.era),
    whip: num(stat.whip),
    homeRuns: num(stat.homeRuns),
    inningsPitched: num(stat.inningsPitched),
    hits: num(stat.hits),
    strikeOuts: num(stat.strikeOuts),
    baseOnBalls: num(stat.baseOnBalls)
  };
}

function scoreBasePlayer(hitter, pitcher, powerProfile = null) {
  const pa = Math.max(1, num(hitter.plateAppearances));
  const hrRate = num(hitter.hr) / pa;
  const xbhRate =
    (num(hitter.doubles) + num(hitter.triples) + num(hitter.hr)) / pa;

  const fallbackPower =
    scale(hrRate, 0.005, 0.09) * 0.38 +
    scale(hitter.slg, 0.320, 0.700) * 0.28 +
    scale(hitter.ops, 0.650, 1.100) * 0.18 +
    scale(xbhRate, 0.035, 0.150) * 0.16;

  const truePower = num(powerProfile?.truePowerScore, fallbackPower);
  const hrPower = num(powerProfile?.hrPowerIndex, fallbackPower);
  const launchPower = num(powerProfile?.launchPowerScore, fallbackPower);
  const contactDamage = num(powerProfile?.contactDamageScore, fallbackPower);

  const pitcherRisk = pitcher
    ? scale(pitcher.homeRuns, 0, 30) * 0.50 +
      scale(pitcher.era, 2.50, 6.50) * 0.25 +
      scale(pitcher.whip, 0.95, 1.60) * 0.25
    : 50;

  const samplePenalty =
    num(powerProfile?.samplePenalty) ||
    (hitter.plateAppearances < 40 ? 10 : hitter.plateAppearances < 80 ? 5 : 0);

  const strikeoutDrag = num(powerProfile?.strikeoutDrag);

  const score =
    truePower * 0.42 +
    hrPower * 0.24 +
    launchPower * 0.16 +
    contactDamage * 0.08 +
    pitcherRisk * 0.10 -
    samplePenalty -
    strikeoutDrag;

  return Math.round(clamp(score));
}

function edgeLabel(score) {
  if (score >= 82) return "Core";
  if (score >= 74) return "Strong";
  if (score >= 66) return "Live";
  if (score >= 58) return "Watch";
  return "Longshot";
}

async function buildBaseRows() {
  if (!fs.existsSync(POOL_FILE)) {
    throw new Error("Missing website/data/mlb_player_pool.json. Run MLB Player Pool first.");
  }

  const poolData = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
  const players = poolData.players || [];

  const powerProfileData = fs.existsSync(POWER_PROFILE_FILE)
    ? JSON.parse(fs.readFileSync(POWER_PROFILE_FILE, "utf8"))
    : { players: [] };

  const powerProfiles = new Map(
    (powerProfileData.players || []).map(profile => [
      String(profile.playerId || profile.player).toLowerCase(),
      profile
    ])
  );

  const pitcherCache = new Map();
  const rows = [];

  for (const player of players) {
    if (!player.playerId) continue;

    console.log(`Modeling ${player.player}`);

    const bio = await getPlayerBio(player.playerId);
    const hitter = await getHitterStats(player.playerId);

    const pitcherId = player.opposingProbablePitcherId;
    let pitcher = null;

    if (pitcherId) {
      if (!pitcherCache.has(pitcherId)) {
        pitcherCache.set(pitcherId, await getPitcherStats(pitcherId));
      }
      pitcher = pitcherCache.get(pitcherId);
    }

    const powerProfile =
      powerProfiles.get(String(player.playerId).toLowerCase()) ||
      powerProfiles.get(String(player.player).toLowerCase()) ||
      null;

    const score = scoreBasePlayer(hitter, pitcher, powerProfile);

    rows.push({
      rank: 0,
      player: player.player,
      batSide: bio.batSide,
      batSideDescription: bio.batSideDescription,
      playerId: player.playerId,
      team: player.team,
      opponent: player.opponent,
      game: player.game,
      venue: player.venue,
      opposingPitcher: player.opposingProbablePitcher || "TBD",
      score,
      truePowerScore: powerProfile?.truePowerScore ?? null,
      hrPowerIndex: powerProfile?.hrPowerIndex ?? null,
      launchPowerScore: powerProfile?.launchPowerScore ?? null,
      contactDamageScore: powerProfile?.contactDamageScore ?? null,
      powerTier: powerProfile?.powerTier ?? null,
      odds: "N/A",
      edge: edgeLabel(score),
      note: `HR ${hitter.hr} • SLG ${hitter.slg || "--"} • OPS ${hitter.ops || "--"}`,
      stats: {
        hitter,
        pitcher
      }
    });
  }

  return rows
    .sort((a, b) => num(b.score) - num(a.score))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}


function recentScore(row) {
  const text = [
    row.note,
    row.why,
    row.reason,
    Array.isArray(row.reasons) ? row.reasons.join(" ") : ""
  ].filter(Boolean).join(" ").toLowerCase();

  let score = 0;

  if (text.includes("hot")) score += 26;
  if (text.includes("due")) score += 18;
  if (text.includes("hr")) score += 14;
  if (text.includes("barrel")) score += 16;
  if (text.includes("hard")) score += 12;
  if (text.includes("pull")) score += 10;
  if (text.includes("flyball")) score += 10;
  if (text.includes("crush")) score += 14;

  const hr7 = num(row.last7Hr ?? row.l7Hr ?? row.recentHr);
  const slg7 = num(row.last7Slg ?? row.l7Slg ?? row.slgLast7);
  const ops7 = num(row.last7Ops ?? row.l7Ops);

  score += hr7 * 20;
  score += scale(slg7, 0.320, 0.950) * 0.65;
  score += scale(ops7, 0.650, 1.300) * 0.45;

  return clamp(score);
}

function pitchPunishment(row) {
  return clamp(
    num(row.pitchEdge) * 0.42 +
    num(row.bestPitchScore) * 0.18 +
    num(row.zoneOverlap) * 0.22 +
    num(row.hotZoneCount) * 4.5
  );
}

function hrLeak(row) {
  return clamp(
    num(row.pitcherRisk) * 0.55 +
    num(row.pitcherLeak) * 0.25 +
    num(row.bullpen) * 0.20
  );
}

function lineupAttackBoost(row, allRows) {
  const pitcher = row.opposingPitcher || row.pitcher || row.vsPitcher || "";
  if (!pitcher) return 0;

  const samePitcher = allRows.filter(r => {
    const p = r.opposingPitcher || r.pitcher || r.vsPitcher || "";
    return p === pitcher;
  });

  if (!samePitcher.length) return 0;

  const avgLeak =
    samePitcher.reduce((sum, r) => sum + num(r.pitcherRisk ?? r.pitcherLeak ?? 0), 0) / samePitcher.length;

  const strongBats = samePitcher.filter(r => {
    const hr = stat(r, "hr");
    const iso = num(r.iso ?? 0);
    return hr >= 5 || iso >= .170;
  }).length;

  const archetypes = samePitcher.filter(r => num(r.hrArchetypeScore ?? 0) >= 40).length;

  let boost = 0;
  boost += scale(avgLeak, 20, 80) * 0.45;
  boost += strongBats * 4.5;
  boost += archetypes * 6;

  if (strongBats >= 4) boost += 12;
  if (archetypes >= 3) boost += 14;

  return clamp(boost);
}

function environment(row) {
  return clamp(
    num(row.weather) * 0.45 +
    num(row.parkFactor ?? row.parkBoost ?? row.hrParkFactor) * 0.35 +
    num(row.bullpen) * 0.20
  );
}

function hrArchetype(row) {
  const hr = stat(row, "hr");
  const avg = stat(row, "avg");
  const slg = stat(row, "slg");
  const ops = stat(row, "ops");
  const iso = num(row.iso ?? Math.max(0, slg - avg));

  const barrel =
    num(row.barrelRate ?? row.barrelPct ?? row.brlPct ?? row.brl) ||
    scale(iso, 0.090, 0.340) * 0.75 ||
    scale(slg, 0.360, 0.680) * 0.55;

  const hh =
    num(row.hardHitRate ?? row.hardHitPct ?? row.hhPct ?? row.hh) ||
    scale(ops, 0.680, 1.050) * 0.55;

  const hr7 = num(row.last7Hr ?? row.l7Hr ?? row.recentHr);
  const slg7 = num(row.last7Slg ?? row.l7Slg ?? row.slgLast7);
  const ops7 = num(row.last7Ops ?? row.l7Ops);

  let score = 0;

  score += scale(hr, 0, 24) * 0.26;
  score += scale(iso, 0.090, 0.340) * 0.22;
  score += scale(slg, 0.340, 0.660) * 0.14;
  score += scale(barrel, 4, 16) * 0.16;
  score += scale(hh, 35, 58) * 0.10;
  score += scale(hr7, 0, 4) * 0.07;
  score += scale(slg7, 0.320, 0.950) * 0.03;
  score += scale(ops7, 0.650, 1.250) * 0.02;

  if (avg <= .255 && iso >= .185) score += 6;
  if (avg <= .245 && slg >= .430) score += 5;
  if (ops < .820 && iso >= .210) score += 5;
  if (hr >= 8 && slg >= .420) score += 6;
  if (hr >= 12) score += 6;
  if (barrel >= 12) score += 5;
  if (hh >= 50) score += 4;
  if (hr7 >= 2) score += 7;
  if (hr7 >= 3) score += 5;

  return clamp(score);
}

function enrichVolatility(row, allRows) {
  const hr = stat(row, "hr");
  const slg = stat(row, "slg");
  const ops = stat(row, "ops");
  const iso = num(row.iso ?? row.ISO ?? Math.max(0, slg - stat(row, "avg")));

  const barrel =
    num(row.barrelRate ?? row.barrelPct ?? row.brl ?? row.brlPct) ||
    scale(iso, 0.090, 0.320) * 0.75 ||
    scale(slg, 0.340, 0.620) * 0.70;

  const hardHit =
    num(row.hardHitRate ?? row.hardHitPct ?? row.hh ?? row.hhPct) ||
    scale(ops, 0.650, 0.950) * 0.65;

  const zonePower = clamp(
    bestZone(row, ["isoZones"]) * 135 +
    bestZone(row, ["slgZones"]) * 55 +
    bestZone(row, ["hrZones"]) * 10
  );

  const barrelScore = clamp(barrel * 8.8);
  const hardHitScore = clamp(hardHit * 2.25);
  const hrScore = scale(hr, 0, 30);
  const isoScore = scale(iso, 0.090, 0.340);

  const rawPower = clamp(
    hrScore * 0.48 +
    isoScore * 0.32 +
    scale(slg, 0.360, 0.700) * 0.14 +
    scale(ops, 0.720, 1.100) * 0.06
  );

  const pitchScore = pitchPunishment(row);
  const leakScore = hrLeak(row);
  const recent = recentScore(row);
  const env = environment(row);
  const archetype = hrArchetype(row);

  const rawLineupBoost = lineupAttackBoost(row, allRows);
  const lineupMultiplier =
    archetype >= 70 ? 1.00 :
    archetype >= 50 ? 0.70 :
    archetype >= 35 ? 0.45 :
    0.18;

  const lineupBoost = rawLineupBoost * lineupMultiplier;

  const hr7 = num(row.last7Hr ?? row.l7Hr ?? row.recentHr);
  const hotHrBoost =
    hr7 >= 4 ? 24 :
    hr7 >= 3 ? 18 :
    hr7 >= 2 ? 12 :
    hr7 >= 1 ? 6 : 0;

  const score = clamp(
    archetype * 0.28 +
    barrelScore * 0.24 +
    hardHitScore * 0.18 +
    rawPower * 0.16 +
    recent * 0.10 +
    pitchScore * 0.06 +
    lineupBoost * 0.03 +
    hotHrBoost * 0.01 +
    leakScore * 0.005 +
    env * 0.005
  );

  const current = num(row.hrConfidence ?? row.score ?? row.powerScore, 0);
  const finalScore = clamp(current * 0.03 + score * 0.97);

  return {
    ...row,
    barrelScore: round1(barrelScore),
    hardHitScore: round1(hardHitScore),
    pitchPunishment: round1(pitchScore),
    hrLeakFactor: round1(leakScore),
    hotZoneAttack: round1(zonePower),
    recentHRTrend: round1(recent),
    hrEnvironmentScore: round1(env),
    rawLineupAttackBoost: round1(rawLineupBoost),
    lineupAttackBoost: round1(lineupBoost),
    hrArchetypeScore: round1(archetype),
    hrVolatilityScore: round1(score),
    oldScore: current,
    score: Math.round(finalScore),
    hrConfidence: round1(finalScore),
    volatilityTier:
      finalScore >= 54 ? "Nuclear" :
      finalScore >= 45 ? "Explosive" :
      finalScore >= 36 ? "Strong HR Spot" :
      finalScore >= 28 ? "Live HR Spot" :
      "Watchlist"
  };
}

function playerLookup(store, row) {
  const players = store?.players || store || {};
  return (
    players[String(row.playerId || "")] ||
    players[row.player] ||
    players[key(row.player)] ||
    null
  );
}

function damageRows(row, pitchDamageData) {
  const found = playerLookup(pitchDamageData, row);
  const damage = found?.pitchDamage || found?.damage || found?.pitches || {};
  if (Array.isArray(damage)) return damage;
  return Object.values(damage).filter(Boolean);
}

function pitchScore(pitch) {
  const avg = num(pitch.avg);
  const slg = num(pitch.slg);
  const iso = num(pitch.iso);
  const hr = num(pitch.hr ?? pitch.homeRuns);
  const crush = num(pitch.crush ?? pitch.crushScore);
  const whiff = num(pitch.whiff ?? pitch.whiffRate);

  let score = 0;

  score += clamp(((slg - 0.350) / 0.350) * 100) * 0.32;
  score += clamp(((iso - 0.120) / 0.260) * 100) * 0.22;
  score += clamp((hr / 6) * 100) * 0.18;
  score += clamp(crush) * 0.18;
  score += clamp(((avg - 0.220) / 0.140) * 100) * 0.06;
  score += clamp(whiff) * 0.04;

  return clamp(score);
}

function classifyPitch(score) {
  if (score >= 78) return "Pitch Destroyer";
  if (score >= 64) return "Pitch Crusher";
  if (score >= 50) return "Pitch Edge";
  if (score >= 35) return "Pitch Lean";
  return "Neutral";
}

function enrichPitchTypeDestruction(row, pitchDamageData) {
  const pitches = damageRows(row, pitchDamageData);

  if (!pitches.length) {
    return {
      ...row,
      pitchTypeDestructionScore: 0,
      pitchTypeDestructionPitch: row.bestPitch || "",
      pitchTypeDestructionTag: "Neutral",
      pitchTypeDestructionReason: "Pitch type damage is still building."
    };
  }

  const ranked = pitches
    .map(pitch => ({ pitch, score: pitchScore(pitch) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const bestPitch =
    best.pitch.label ||
    best.pitch.pitch ||
    best.pitch.type ||
    row.bestPitch ||
    "Best pitch";

  const destruction = round1(best.score);
  const tag = classifyPitch(destruction);

  const bonus =
    destruction >= 78 ? 8 :
    destruction >= 64 ? 6 :
    destruction >= 50 ? 4 :
    destruction >= 35 ? 2 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const newScore = clamp(base + bonus);
  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];

  if (bonus > 0) reasons.push(`${tag} vs ${bestPitch}`);

  return {
    ...row,
    score: round1(newScore),
    hrConfidence: round1(newScore),
    pitchTypeDestructionScore: destruction,
    pitchTypeDestructionPitch: bestPitch,
    pitchTypeDestructionTag: tag,
    pitchTypeDestructionBonus: bonus,
    pitchTypeDestructionReason: `${tag} profile against ${bestPitch}`,
    bestPitch: row.bestPitch || bestPitch,
    reasons
  };
}

function teamOf(row) {
  return key(row.team);
}

function gameKey(row) {
  return key(row.game || `${row.team} ${row.opponent}`);
}

function weatherFor(row, weatherData) {
  const rows = arr(weatherData);
  return rows.find(w => key(w.game) === gameKey(row)) ||
    rows.find(w => key(w.homeTeam) === teamOf(row) || key(w.awayTeam) === teamOf(row)) ||
    rows.find(w => key(w.team) === teamOf(row)) ||
    {};
}

function pullDirection(row) {
  const bat = String(row.batSide || row.bats || row.batSideDescription || "").toUpperCase();
  if (bat.startsWith("L")) return "RF";
  if (bat.startsWith("R")) return "LF";
  return "CF";
}

function windBoost(row, weather) {
  const pull = pullDirection(row);
  const text = [
    weather.windDirection,
    weather.windCompass,
    weather.windDescription,
    weather.wind,
    row.weatherNote
  ].filter(Boolean).join(" ").toUpperCase();

  const speed = num(weather.windSpeed ?? weather.wind_mph ?? weather.windMph);

  let directionScore = 0;

  if (text.includes("OUT")) directionScore += 35;
  if (pull === "RF" && (text.includes("RF") || text.includes("RIGHT"))) directionScore += 35;
  if (pull === "LF" && (text.includes("LF") || text.includes("LEFT"))) directionScore += 35;
  if (pull === "CF" && (text.includes("CF") || text.includes("CENTER"))) directionScore += 25;
  if (text.includes("IN")) directionScore -= 30;

  return clamp(directionScore + Math.min(30, speed * 2.2));
}

function parkBoost(row) {
  return clamp(
    num(row.parkFactor ?? row.parkBoost ?? row.hrParkFactor) * 18 +
    num(row.weather) * 0.45
  );
}

function pullPower(row) {
  const hr = num(row.stats?.hitter?.hr ?? row.hitterStats?.hr ?? row.hr ?? row.homeRuns);
  const slg = num(row.stats?.hitter?.slg ?? row.hitterStats?.slg ?? row.slg);
  const avg = num(row.stats?.hitter?.avg ?? row.hitterStats?.avg ?? row.avg);
  const iso = num(row.iso ?? Math.max(0, slg - avg));
  const archetype = num(row.hrArchetypeScore);

  return clamp(
    archetype * 0.40 +
    Math.min(100, hr * 4.5) * 0.25 +
    Math.min(100, iso * 320) * 0.25 +
    Math.min(100, slg * 115) * 0.10
  );
}

function pullWindScore(row, weatherData) {
  const weather = weatherFor(row, weatherData);
  const wind = windBoost(row, weather);
  const park = parkBoost(row);
  const power = pullPower(row);

  return clamp(wind * 0.38 + park * 0.22 + power * 0.40);
}

function pullWindTag(score) {
  if (score >= 75) return "Pull Wind Nuke";
  if (score >= 60) return "Pull Carry Boost";
  if (score >= 45) return "Carry Edge";
  if (score >= 30) return "Small Carry";
  return "Neutral";
}

function enrichPullWind(row, weatherData) {
  const score = pullWindScore(row, weatherData);
  const bonus =
    score >= 75 ? 7 :
    score >= 60 ? 5 :
    score >= 45 ? 3 :
    score >= 30 ? 1.5 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const next = clamp(base + bonus);
  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];

  if (bonus > 0) reasons.push(`${pullWindTag(score)} to ${pullDirection(row)}`);

  return {
    ...row,
    score: round1(next),
    hrConfidence: round1(next),
    pullSideField: pullDirection(row),
    pullWindHrScore: round1(score),
    pullWindHrTag: pullWindTag(score),
    pullWindHrBonus: bonus,
    reasons
  };
}

function launchProfileScore(row) {
  const hr = stat(row, "hr");
  const avg = stat(row, "avg");
  const slg = stat(row, "slg");
  const ops = stat(row, "ops");
  const iso = num(row.iso ?? Math.max(0, slg - avg));

  const archetype = num(row.hrArchetypeScore);
  const pitchDestroy = num(row.pitchTypeDestructionScore);
  const pullWind = num(row.pullWindHrScore);
  const zonePower =
    bestZone(row, ["hrZones"]) * 18 +
    bestZone(row, ["slgZones"]) * 65 +
    bestZone(row, ["isoZones"]) * 115;

  const flyballProxy = clamp(
    scale(hr, 0, 30) * 0.34 +
    scale(iso, 0.090, 0.340) * 0.30 +
    scale(slg, 0.350, 0.700) * 0.18 +
    scale(ops, 0.720, 1.100) * 0.08 +
    clamp(zonePower) * 0.10
  );

  return clamp(
    archetype * 0.36 +
    flyballProxy * 0.30 +
    pitchDestroy * 0.14 +
    pullWind * 0.12 +
    clamp(zonePower) * 0.08
  );
}

function launchTag(score) {
  if (score >= 82) return "Elite Lift HR Profile";
  if (score >= 68) return "Strong Lift HR Profile";
  if (score >= 52) return "Playable Lift";
  if (score >= 38) return "Some Lift";
  return "Low Lift";
}

function enrichLaunchProfile(row) {
  const score = launchProfileScore(row);
  const bonus =
    score >= 82 ? 8 :
    score >= 68 ? 6 :
    score >= 52 ? 4 :
    score >= 38 ? 2 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const next = clamp(base + bonus);
  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];

  if (bonus > 0) reasons.push(launchTag(score));

  return {
    ...row,
    score: round1(next),
    hrConfidence: round1(next),
    launchHrProfileScore: round1(score),
    launchHrTag: launchTag(score),
    launchHrBonus: bonus,
    reasons
  };
}

function bullpenRows() {
  return arr(read("bullpen_collapse_engine.json", []));
}

function findBullpen(row, rows) {
  const opp = key(row.opponent);
  return rows.find(r =>
    key(r.team) === opp ||
    key(r.Team) === opp ||
    key(r.opponent) === opp
  ) || {};
}

function bullpenScore(row, bullpen) {
  const bullpenRisk =
    num(row.bullpen) ||
    num(bullpen.collapseScore) ||
    num(bullpen.dangerScore) ||
    num(bullpen.hrRiskScore) ||
    num(bullpen.bullpenScore);

  const pitcherRisk = num(row.pitcherRisk);
  const leak = num(row.hrLeakFactor);
  const archetype = num(row.hrArchetypeScore);
  const latePower = num(row.launchHrProfileScore);

  return clamp(
    bullpenRisk * 0.38 +
    pitcherRisk * 0.18 +
    leak * 0.14 +
    archetype * 0.16 +
    latePower * 0.14
  );
}

function bullpenTag(score) {
  if (score >= 75) return "Late Game HR Spike";
  if (score >= 60) return "Bullpen HR Boost";
  if (score >= 45) return "Late Game Edge";
  if (score >= 30) return "Small Bullpen Edge";
  return "Neutral";
}

function enrichBullpenInheritance(row, bullpenData) {
  const bp = findBullpen(row, bullpenData);
  const score = bullpenScore(row, bp);

  const bonus =
    score >= 75 ? 7 :
    score >= 60 ? 5 :
    score >= 45 ? 3 :
    score >= 30 ? 1.5 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const next = clamp(base + bonus);
  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];

  if (bonus > 0) reasons.push(bullpenTag(score));

  return {
    ...row,
    score: round1(next),
    hrConfidence: round1(next),
    bullpenInheritanceScore: round1(score),
    bullpenInheritanceTag: bullpenTag(score),
    bullpenInheritanceBonus: bonus,
    reasons
  };
}

function recentHr(row) {
  return num(row.last7Hr ?? row.l7Hr ?? row.recentHr);
}

function ceilingScore(row) {
  const hr = stat(row, "hr");
  const avg = stat(row, "avg");
  const slg = stat(row, "slg");
  const iso = num(row.iso ?? Math.max(0, slg - avg));

  const archetype = num(row.hrArchetypeScore);
  const pitchDestroy = num(row.pitchTypeDestructionScore);
  const launch = num(row.launchHrProfileScore);
  const pullWind = num(row.pullWindHrScore);
  const bullpen = num(row.bullpenInheritanceScore);
  const lineup = num(row.lineupAttackBoost);
  const volatility = num(row.hrVolatilityScore);
  const hr7 = recentHr(row);

  const seasonPower = clamp(
    scale(hr, 0, 35) * 0.58 +
    scale(iso, 0.100, 0.360) * 0.42
  );

  const recentNuke =
    hr7 >= 4 ? 100 :
    hr7 >= 3 ? 85 :
    hr7 >= 2 ? 68 :
    hr7 >= 1 ? 42 :
    0;

  return clamp(
    archetype * 0.24 +
    launch * 0.18 +
    pitchDestroy * 0.16 +
    seasonPower * 0.14 +
    volatility * 0.12 +
    recentNuke * 0.08 +
    pullWind * 0.04 +
    bullpen * 0.025 +
    lineup * 0.015
  );
}

function ceilingTag(score) {
  if (score >= 82) return "Slate Breaker";
  if (score >= 68) return "Multi HR Ceiling";
  if (score >= 54) return "Nuclear Upside";
  if (score >= 40) return "One Swing Plus";
  return "Standard HR Upside";
}

function enrichMultiHrCeiling(row) {
  const score = ceilingScore(row);
  const bonus =
    score >= 82 ? 8 :
    score >= 68 ? 6 :
    score >= 54 ? 4 :
    score >= 40 ? 2 :
    0;

  const base = num(row.hrConfidence ?? row.score);
  const next = clamp(base + bonus);
  const reasons = Array.isArray(row.reasons) ? [...row.reasons] : [];

  if (bonus > 0) reasons.push(ceilingTag(score));

  return {
    ...row,
    score: round1(next),
    hrConfidence: round1(next),
    multiHrCeilingScore: round1(score),
    multiHrCeilingTag: ceilingTag(score),
    multiHrCeilingBonus: bonus,
    reasons
  };
}

function rankRows(rows) {
  return [...rows]
    .sort((a, b) => num(b.hrConfidence ?? b.score) - num(a.hrConfidence ?? a.score))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function runMasterModel(rows) {
  const weather = read("mlb_weather.json", {});
  const pitchDamage = read("pitch_type_damage.json", {});
  const bullpenData = bullpenRows();

  let modeled = rows.map(row => enrichVolatility(row, rows));
  modeled = modeled.map(row => enrichPitchTypeDestruction(row, pitchDamage));
  modeled = modeled.map(row => enrichPullWind(row, weather));
  modeled = modeled.map(row => enrichLaunchProfile(row));
  modeled = modeled.map(row => enrichBullpenInheritance(row, bullpenData));
  modeled = modeled.map(row => enrichMultiHrCeiling(row));

  return rankRows(modeled);
}

function updatePlayerCardData() {
  const cardData = read("player_card_data.json", null);
  if (!cardData) return { updated: false, count: 0 };

  const rows = arr(cardData);
  if (!rows.length) return { updated: false, count: 0 };

  const modeled = runMasterModel(rows);

  if (Array.isArray(cardData)) {
    write("player_card_data.json", modeled);
  } else if (cardData.players) {
    write("player_card_data.json", { ...cardData, players: modeled });
  }

  return { updated: true, count: modeled.length };
}

async function main() {
  const baseRows = await buildBaseRows();

  if (!Array.isArray(baseRows) || !baseRows.length) {
    throw new Error("Master HR model could not build base rows");
  }

  const modeled = runMasterModel(baseRows);
  write("mlb_home_runs.json", modeled);

  const cardUpdate = updatePlayerCardData();

  console.log("MASTER HR MODEL COMPLETE");
  console.log("Base rows:", baseRows.length);
  console.log("Updated mlb_home_runs.json:", modeled.length);
  if (cardUpdate.updated) {
    console.log("Updated player_card_data.json:", cardUpdate.count);
  }
}

main().catch(err => {
  console.error("MASTER HR MODEL FAILED");
  console.error(err);
  process.exit(1);
});
