const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");

const REGISTRY_FILE = path.join(DATA, "tag_registry.json");
const PLAYER_CARD_FILE = path.join(DATA, "player_card_data.json");
const MARKET_ODDS_FILE = path.join(DATA, "mlb_market_odds.json");
const OUT = path.join(DATA, "public_tags.json");

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function norm(v) {
  return String(v || "").trim().toUpperCase();
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  const out = [];

  for (const key of ["players", "rows", "data", "board", "items", "hitters", "batters", "profiles", "rankings", "picks"]) {
    if (Array.isArray(data[key])) out.push(...data[key]);
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) out.push(...value.filter(v => v && typeof v === "object"));
    else if (value && typeof value === "object") out.push(value);
  }

  return out;
}

function playerName(row) {
  return row?.playerName || row?.name || row?.player || row?.batterName || row?.hitterName || row?.fullName || row?.Player || "Unknown Player";
}

function playerId(row) {
  return row?.playerId || row?.mlbId || row?.id || row?.batterId || row?.hitterId || row?.mlb_id || "";
}

function playerKey(p) {
  return String(p?.playerId || "") + "|" + norm(p?.name || "");
}

function nested(row, path, fallback = "") {
  return path.split(".").reduce((obj, key) => obj && obj[key] !== undefined ? obj[key] : undefined, row) ?? fallback;
}

function scoreOf(row) {
  const values = [
    row?.hrScore,
    row?.score,
    row?.modelScore,
    row?.aiScore,
    row?.powerScore,
    row?.confidence,
    nested(row, "model.score"),
    nested(row, "model.powerScore"),
    nested(row, "model.pitchEdge"),
    nested(row, "model.bullpen")
  ].map(Number).filter(Number.isFinite);

  return values.length ? Math.max(...values) : 0;
}

function americanOddsValue(value) {
  if (value === undefined || value === null || value === "" || value === "N/A") return null;
  const cleaned = String(value).replace(/[^+\-\d.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function oddsIndex(payload) {
  const index = new Map();
  for (const price of rows(payload)) {
    const odds = americanOddsValue(price.overPriceAmerican || price.odds || price.hrOdds || price.bestOdds);
    if (odds === null) continue;
    const key = String(price.playerId || "") || norm(price.player || price.playerName || price.name);
    if (!key) continue;
    const current = index.get(key);
    if (!current || odds > current.odds) {
      index.set(key, { odds, source: price.bookmakerTitle || price.bookmakerKey || "market odds" });
    }
  }
  return index;
}

function oddsFor(row, index) {
  const direct = americanOddsValue(row?.odds || row?.hrOdds || row?.bestOdds || row?.overPriceAmerican);
  if (direct !== null) return direct;
  const byId = index.get(String(playerId(row) || ""));
  if (byId) return byId.odds;
  const byName = index.get(norm(playerName(row)));
  return byName ? byName.odds : null;
}

function uniqPlayers(players) {
  const map = new Map();

  for (const p of players || []) {
    const key = playerKey(p);
    if (!key.trim() || key === "|") continue;

    if (!map.has(key)) {
      map.set(key, {
        playerId: p.playerId || "",
        name: p.name || "Unknown Player",
        confidence: Number(p.confidence || 0.65),
        source: p.source || "tag_registry"
      });
    }
  }

  return [...map.values()];
}

const registry = readJson(REGISTRY_FILE);
const cardData = readJson(PLAYER_CARD_FILE);
const marketOdds = readJson(MARKET_ODDS_FILE);

if (!registry || !Array.isArray(registry.tags)) {
  throw new Error("Missing canonical tag_registry.json");
}

const cards = rows(cardData);
const marketOddsIndex = oddsIndex(marketOdds);
const allTags = registry.tags;
const byTag = new Map(allTags.map(t => [norm(t.tag), t]));

function playersFor(tag) {
  return uniqPlayers(byTag.get(norm(tag))?.players || []);
}

function union(tags) {
  return uniqPlayers(tags.flatMap(playersFor));
}

function intersect(tags) {
  const sets = tags.map(tag => new Map(playersFor(tag).map(p => [playerKey(p), p])));
  if (!sets.length) return [];

  return [...sets[0].entries()]
    .filter(([key]) => sets.every(s => s.has(key)))
    .map(([, p]) => p);
}

function topBoard(limit) {
  const ranked = cards.map(row => {
    const name = playerName(row);
    const id = playerId(row);
    const score = scoreOf(row);

    return {
      playerId: id,
      name,
      confidence: score > 1 ? score / 100 : score,
      source: "player_card_data.json",
      score
    };
  }).filter(p => p.name && p.name !== "Unknown Player");

  return uniqPlayers(ranked.sort((a, b) => b.score - a.score).slice(0, limit));
}

function playerScores() {
  const map = new Map();
  for (const row of cards) {
    const name = playerName(row);
    const id = playerId(row);
    const score = scoreOf(row);
    const keys = [
      String(id || "") + "|" + norm(name),
      String(id || ""),
      "|" + norm(name)
    ];

    for (const key of keys) {
      if (!key || key === "|") continue;
      const current = map.get(key);
      if (!current || score > current.score) {
        map.set(key, { score, source: "player_card_data.json" });
      }
    }
  }
  return map;
}

const boardScores = playerScores();

function boardScoreFor(player) {
  const keys = [
    String(player?.playerId || "") + "|" + norm(player?.name || ""),
    String(player?.playerId || ""),
    "|" + norm(player?.name || "")
  ];

  for (const key of keys) {
    if (!key || key === "|") continue;
    const found = boardScores.get(key);
    if (found) return found.score;
  }

  return Number(player?.confidence || 0);
}

function capByBoard(players, limit) {
  return uniqPlayers(players)
    .map(player => ({
      ...player,
      confidence: Math.max(Number(player.confidence || 0), boardScoreFor(player) > 1 ? boardScoreFor(player) / 100 : boardScoreFor(player))
    }))
    .sort((a, b) => boardScoreFor(b) - boardScoreFor(a) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function liveLongshots(limit = 36) {
  const ranked = cards.map(row => {
    const name = playerName(row);
    const id = playerId(row);
    const score = Number(nested(row, "model.score", scoreOf(row)));
    const power = Number(nested(row, "model.powerScore", 0));
    const bullpen = Number(nested(row, "model.bullpen", 0));
    const pitchEdge = Number(nested(row, "model.pitchEdge", 0));
    const recentIso = Math.max(Number(nested(row, "last7.iso", 0)), Number(nested(row, "last15.iso", 0)));
    const seasonHr = Number(nested(row, "season.hr", 0));
    const last15Hr = Number(nested(row, "last15.hr", 0));
    const odds = oddsFor(row, marketOddsIndex);
    const tags = (row.tags || []).map(norm);

    const hasOddsLongshot = odds !== null && odds >= 400;
    const hasPowerTrend = tags.includes("RECENT HR") || tags.includes("POWER TREND") || recentIso >= 0.18 || last15Hr >= 2;
    const hasEnoughUpside = power >= 35 || seasonHr >= 4 || bullpen >= 70 || pitchEdge >= 32;
    const isTooCore = score >= 52;

    if (!hasOddsLongshot && !(hasPowerTrend && hasEnoughUpside && !isTooCore)) return null;

    const longshotBand = score < 38 ? 18 : score < 45 ? 15 : score < 50 ? 10 : 5;
    const longshotScore =
      (hasOddsLongshot ? 24 : 0) +
      longshotBand +
      Math.min(20, power * 0.25) +
      Math.min(15, bullpen * 0.1) +
      Math.min(12, pitchEdge * 0.18) +
      Math.min(14, recentIso * 38) +
      Math.min(10, last15Hr * 2) +
      Math.min(8, seasonHr * 0.35);

    return {
      playerId: id,
      name,
      confidence: Math.max(0.38, Math.min(0.74, longshotScore / 100)),
      source: odds === null ? "player_card_data.json" : "mlb_market_odds.json",
      score: longshotScore,
      odds
    };
  }).filter(Boolean);

  const sorted = ranked.sort((a, b) => {
    const aOdds = a.odds !== null ? 1 : 0;
    const bOdds = b.odds !== null ? 1 : 0;
    return bOdds - aOdds || b.score - a.score || a.name.localeCompare(b.name);
  });

  return uniqPlayers(sorted).slice(0, limit);
}

function make(tag, category, players, source, description) {
  const clean = uniqPlayers(players);

  const confidence = clean.length
    ? clean.reduce((s, p) => s + Number(p.confidence || 0), 0) / clean.length
    : 0;

  return {
    tag,
    description,
    category,
    players: clean,
    count: clean.length,
    confidence: Number(confidence.toFixed(3)),
    source: Array.from(new Set(source)).sort()
  };
}

const publicTags = [
  make(
    "SMASH SPOT",
    "ai",
    capByBoard([
      ...intersect(["POWER FORM", "PITCHER TARGET"]),
      ...intersect(["POWER BAT", "HR LEAK"]),
      ...intersect(["PITCHER POWER RISK", "POWER FORM"]),
      ...playersFor("MATCHUP WATCH")
    ], 25),
    ["tag_registry.json"],
    "Strong power profile with matchup or pitcher vulnerability support."
  ),

  make(
    "ELITE SMASH",
    "ai",
    capByBoard([
      ...intersect(["ELITE MODEL", "POWER BAT"]),
      ...intersect(["NUCLEAR", "PITCHER POWER RISK"]),
      ...topBoard(10)
    ], 15),
    ["tag_registry.json", "player_card_data.json"],
    "Highest-confidence home run profile from the model and board ranking."
  ),

  make(
    "SMASH + PARK",
    "environment",
    uniqPlayers([
      ...intersect(["WEATHER", "POWER FORM"]),
      ...intersect(["SMALL BULLPEN EDGE", "POWER BAT"]),
      ...intersect(["ZONE 5+", "POWER FORM"])
    ]),
    ["tag_registry.json"],
    "Smash profile with added park, weather, bullpen, or damage-zone support."
  ),

  make(
    "HOMER AI",
    "ai",
    capByBoard(union(["ELITE MODEL", "MATCHUP WATCH", "PROFILE WATCH", "POWER FORM"]), 30),
    ["tag_registry.json"],
    "AI-selected home run profile built from model and matchup signals."
  ),

  make(
    "LIVE LONGSHOTS",
    "market",
    liveLongshots(36),
    ["player_card_data.json", "mlb_market_odds.json"],
    "Volatile HR watchlist bats with longshot odds when available, or power-trend upside when books are unavailable."
  ),

  make(
    "TOP 5",
    "rank",
    topBoard(5),
    ["player_card_data.json"],
    "Top 5 players by today's available board scoring."
  ),

  make(
    "TOP 10",
    "rank",
    topBoard(10),
    ["player_card_data.json"],
    "Top 10 players by today's available board scoring."
  ),

  make(
    "TOP 30",
    "rank",
    topBoard(30),
    ["player_card_data.json"],
    "Top 30 players by today's available board scoring."
  )
];

const output = {
  generatedAt: new Date().toISOString(),
  canonical: true,
  sourceType: "public_ai_tags",
  dependsOn: [
    "tag_registry.json",
    "player_card_data.json"
  ],
  totalTags: publicTags.length,
  totalTaggedPlayers: new Set(
    publicTags.flatMap(t => t.players.map(p => p.playerId || p.name).filter(Boolean))
  ).size,
  tags: publicTags
};

fs.writeFileSync(OUT, JSON.stringify(output, null, 2));

console.log(`Built ${OUT}`);
console.log(`Public tags: ${output.totalTags}`);
console.log(`Tagged players: ${output.totalTaggedPlayers}`);

for (const tag of publicTags) {
  console.log(`${tag.tag}: ${tag.count}`);
}
