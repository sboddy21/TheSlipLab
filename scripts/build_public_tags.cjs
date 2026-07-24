const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");

const REGISTRY_FILE = path.join(DATA, "tag_registry.json");
const PLAYER_CARD_FILE = path.join(DATA, "player_card_data.json");
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

if (!registry || !Array.isArray(registry.tags)) {
  throw new Error("Missing canonical tag_registry.json");
}

const cards = rows(cardData);
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

    const score = Math.max(
      Number(row.hrScore || 0),
      Number(row.score || 0),
      Number(row.modelScore || 0),
      Number(row.aiScore || 0),
      Number(row.powerScore || 0),
      Number(row.confidence || 0)
    );

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
    uniqPlayers([
      ...intersect(["POWER FORM", "PITCHER TARGET"]),
      ...intersect(["POWER BAT", "HR LEAK"]),
      ...intersect(["PITCHER POWER RISK", "POWER FORM"]),
      ...playersFor("MATCHUP WATCH")
    ]),
    ["tag_registry.json"],
    "Strong power profile with matchup or pitcher vulnerability support."
  ),

  make(
    "ELITE SMASH",
    "ai",
    uniqPlayers([
      ...intersect(["ELITE MODEL", "POWER BAT"]),
      ...intersect(["NUCLEAR", "PITCHER POWER RISK"]),
      ...topBoard(10)
    ]),
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
    "POWER PLAY",
    "power",
    union(["POWER BAT", "POWER FORM", "POWER TREND", "LONGSHOT POWER", "PITCHER POWER RISK"]),
    ["tag_registry.json"],
    "Power-first profile with meaningful home run upside."
  ),

  make(
    "MODEL'S BEST",
    "model",
    uniqPlayers([
      ...playersFor("ELITE MODEL"),
      ...topBoard(30)
    ]),
    ["tag_registry.json", "player_card_data.json"],
    "Players prioritized by the Slip Lab model across confidence and board score."
  ),

  make(
    "+EV VALUE",
    "market",
    union(["LONGSHOT", "LONGSHOT POWER", "OPS EDGE", "TRAFFIC EDGE"]),
    ["tag_registry.json"],
    "Value-oriented profile with longshot, market, OPS, or traffic support."
  ),

  make(
    "HOMER AI",
    "ai",
    union(["ELITE MODEL", "MATCHUP WATCH", "PROFILE WATCH", "POWER FORM"]),
    ["tag_registry.json"],
    "AI-selected home run profile built from model and matchup signals."
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
  ),

  make(
    "ZONE 5+",
    "zone",
    playersFor("ZONE 5+"),
    ["tag_registry.json"],
    "Players carrying the Zone 5+ damage-zone signal."
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
