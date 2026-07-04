const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");

const PUBLIC_TAGS = path.join(DATA, "public_tags.json");
const PLAYER_CARDS = path.join(DATA, "player_card_data.json");
const MATCHUPS = path.join(DATA, "game_pitcher_matchups.json");
const OUT = path.join(DATA, "ai_2.json");

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
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

function norm(v) {
  return String(v || "").trim().toUpperCase();
}

function playerName(row) {
  return row?.playerName || row?.name || row?.player || row?.batterName || row?.hitterName || row?.fullName || row?.Player || "Unknown Player";
}

function playerId(row) {
  return row?.playerId || row?.mlbId || row?.id || row?.batterId || row?.hitterId || row?.mlb_id || "";
}

function key(id, name) {
  return String(id || "") + "|" + norm(name || "");
}

function scoreOf(row) {
  const vals = [
    row.hrScore,
    row.score,
    row.modelScore,
    row.aiScore,
    row.powerScore,
    row.confidence,
    row.aiConfidence,
    row.modelConfidence
  ].map(Number).filter(Number.isFinite);

  if (!vals.length) return 0;
  return Math.max(...vals);
}

function takeFor(tag, player, card) {
  const name = player.name;
  const score = Math.round((player.aiScore || player.confidence || 0) * 100);

  const base = {
    "SMASH SPOT": `${name} checks the key power and matchup boxes for a live HR profile.`,
    "ELITE SMASH": `${name} grades as one of the strongest AI-backed HR profiles on the board.`,
    "SMASH + PARK": `${name} carries a power profile with added park, weather, zone, or environment support.`,
    "POWER PLAY": `${name} brings enough raw power to stay live even without needing every signal perfect.`,
    "MODEL'S BEST": `${name} is being elevated by the model across confidence, board rank, and supporting signals.`,
    "+EV VALUE": `${name} profiles as a value target where the underlying signal mix is stronger than the market price implies.`,
    "HOMER AI": `${name} is being flagged by the AI from combined model, matchup, and player-form signals.`,
    "TOP 10": `${name} sits inside today's top 10 by available board scoring.`,
    "TOP 30": `${name} sits inside today's top 30 by available board scoring.`,
    "ZONE 5+": `${name} has a damage-zone signal strong enough to matter in the HR model.`
  };

  return card?.analystTake || card?.cardTake || card?.summary || base[tag] || `${name} fits this AI section with a ${score || "live"} confidence profile.`;
}

const publicTags = readJson(PUBLIC_TAGS);
const playerCardsRaw = readJson(PLAYER_CARDS, {});
const matchups = readJson(MATCHUPS, {});

if (!publicTags || !Array.isArray(publicTags.tags)) {
  throw new Error("Missing canonical public_tags.json");
}

const cards = rows(playerCardsRaw);
const cardMap = new Map();

for (const row of cards) {
  const id = playerId(row);
  const name = playerName(row);
  cardMap.set(key(id, name), row);
  if (name) cardMap.set("|" + norm(name), row);
}

function findCard(player) {
  return cardMap.get(key(player.playerId, player.name)) || cardMap.get("|" + norm(player.name)) || null;
}

const sections = publicTags.tags.map(tag => {
  const players = (tag.players || []).map(p => {
    const card = findCard(p);
    const rawScore = scoreOf(card || {});
    const confidence = Number(p.confidence || 0);
    const aiScore = rawScore > 1 ? rawScore / 100 : Math.max(rawScore, confidence);

    return {
      playerId: p.playerId || "",
      name: p.name || "Unknown Player",
      confidence: Number(Math.max(confidence, aiScore || 0).toFixed(3)),
      aiScore: Number((aiScore || confidence || 0).toFixed(3)),
      source: p.source || tag.source?.join(", ") || "public_tags.json",
      tags: [tag.tag],
      take: takeFor(tag.tag, {
        playerId: p.playerId || "",
        name: p.name || "Unknown Player",
        confidence,
        aiScore
      }, card),
      card: card ? {
        team: card.team || card.Team || "",
        opponent: card.opponent || card.Opp || "",
        pitcher: card.pitcher || card.opposingPitcher || card.probablePitcher || "",
        hrScore: card.hrScore || card.score || card.modelScore || "",
        powerScore: card.powerScore || card.power || "",
        recentForm: card.recentForm || card.formScore || card.recentScore || "",
        odds: card.odds || card.hrOdds || card.bestOdds || ""
      } : null
    };
  }).sort((a, b) => b.aiScore - a.aiScore || b.confidence - a.confidence);

  return {
    title: tag.tag,
    description: tag.description,
    category: tag.category,
    count: players.length,
    confidence: tag.confidence,
    source: tag.source,
    players
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  canonical: true,
  sourceType: "slip_lab_ai_2",
  dependsOn: [
    "public_tags.json",
    "player_card_data.json",
    "game_pitcher_matchups.json"
  ],
  summary: {
    sections: sections.length,
    players: new Set(sections.flatMap(s => s.players.map(p => p.playerId || p.name).filter(Boolean))).size,
    games: Array.isArray(matchups.games) ? matchups.games.length : 0
  },
  sections
};

fs.writeFileSync(OUT, JSON.stringify(output, null, 2));

console.log(`Built ${OUT}`);
console.log(`Sections: ${output.summary.sections}`);
console.log(`Players: ${output.summary.players}`);
for (const s of sections) {
  console.log(`${s.title}: ${s.count}`);
}
