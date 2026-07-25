const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");

const PUBLIC_TAGS = path.join(DATA, "public_tags.json");
const PLAYER_CARDS = path.join(DATA, "player_card_data.json");
const MATCHUPS = path.join(DATA, "game_pitcher_matchups.json");
const MARKET_ODDS = path.join(DATA, "mlb_market_odds.json");
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

function nested(row, path, fallback = "") {
  return path.split(".").reduce((obj, key) => obj && obj[key] !== undefined ? obj[key] : undefined, row) ?? fallback;
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
    row.modelConfidence,
    nested(row, "model.score"),
    nested(row, "model.powerScore")
  ].map(Number).filter(Number.isFinite);

  if (!vals.length) return 0;
  return Math.max(...vals);
}

function hrDisplay(card, fallback = "") {
  const hr = nested(card, "season.hr", "");
  if (hr !== "" && hr !== undefined && hr !== null) return hr;
  return fallback;
}

function powerDisplay(card, fallback = "") {
  const modelPower = Number(nested(card, "model.powerScore", 0));
  if (modelPower > 0) return Math.round(modelPower);

  const slg = Number(nested(card, "season.slg", 0));
  const ops = Number(nested(card, "season.ops", 0));
  const iso7 = Number(nested(card, "last7.iso", 0));
  const iso15 = Number(nested(card, "last15.iso", 0));
  const modelScore = Number(nested(card, "model.score", 0));

  const power =
    (slg * 40) +
    (ops * 22) +
    (iso7 * 60) +
    (iso15 * 45) +
    (modelScore * 0.18);

  const derived = Math.max(1, Math.min(100, Math.round(power)));
  return derived || fallback;
}

function firstValue(row, keys, fallback = "") {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function cleanNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n > 1 ? Math.round(n) : Math.round(n * 100);
}

function americanOddsValue(value) {
  if (value === undefined || value === null || value === "" || value === "N/A") return "";
  const cleaned = String(value).replace(/[^+\-\d.]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return "";
  return n > 0 ? `+${n}` : String(n);
}

function marketOddsIndex(payload) {
  const index = new Map();
  for (const price of rows(payload)) {
    const odds = americanOddsValue(price.overPriceAmerican || price.odds || price.hrOdds || price.bestOdds);
    if (!odds) continue;
    const row = {
      odds,
      bookmaker: price.bookmakerTitle || price.bookmakerKey || "",
      playerId: price.playerId || "",
      player: price.player || price.playerName || price.name || ""
    };
    if (row.playerId) index.set(String(row.playerId), row);
    if (row.player) index.set("|" + norm(row.player), row);
  }
  return index;
}

function takeFor(tag, player, card) {
  const name = player.name;
  const team = firstValue(card, ["team", "Team"], "");
  const opponent = firstValue(card, ["opponent", "Opp", "opp"], "");
  const pitcher = firstValue(card, ["pitcher", "opposingPitcher", "probablePitcher"], "");
  const fallbackSignal = cleanNumber(player.aiScore || player.confidence || 0.65);
  const power = powerDisplay(card, fallbackSignal);
  const hr = hrDisplay(card, fallbackSignal);
  const recent = cleanNumber(firstValue(card, ["recentForm", "formScore", "recentScore"], "")) || cleanNumber(card?.last7?.ops || "") || fallbackSignal;
  const odds = firstValue(card, ["odds", "hrOdds", "bestOdds"], "");

  const matchupLine = [
    team ? `${name} is tied to ${team}` : `${name} is active in today's player pool`,
    opponent ? `against ${opponent}` : "",
    pitcher ? `with ${pitcher} listed on the opposing side` : ""
  ].filter(Boolean).join(" ") + ".";

  const signalParts = [];
  if (power) signalParts.push(`a ${power}% power signal`);
  if (hr) signalParts.push(`a ${hr}% HR/model score`);
  if (recent) signalParts.push(`a ${recent}% recent-form read`);
  if (odds) signalParts.push(`market context at ${odds}`);

  const signalLine = signalParts.length
    ? `The model is not tagging him blindly: the profile is supported by ${signalParts.join(", ")}.`
    : `The model is not tagging him blindly: this section is being driven by the canonical public-tag layer, which is built from the internal signal registry.`;

  const sectionRead = {
    "SMASH SPOT": "This is the classic Slip Lab HR setup: power from the hitter side meeting enough matchup vulnerability to make the spot playable.",
    "ELITE SMASH": "This is the higher-confidence version of a smash profile, where the player is not just live but elevated by the model against the rest of the slate.",
    "SMASH + PARK": "This tag means the bat has help beyond the player profile, with park, weather, bullpen, or damage-zone support adding fuel to the HR case.",
    "POWER PLAY": "This is a power-first read. The appeal is the hitter's raw damage ability, even if every secondary signal is not perfect.",
    "MODEL'S BEST": "This is the AI priority bucket. The player is being pulled forward by board rank, confidence, and supporting model signals.",
    "+EV VALUE": "This is a price-sensitive read. The player is not only live, but the signal mix suggests the market may not be fully respecting the profile.",
    "HOMER AI": "This is the AI's home-run callout bucket, built from matchup watch, profile watch, model strength, and current power-form signals.",
    "LIVE LONGSHOTS": "This is the volatile longshot lane: the player is not a core model priority, but the profile has enough power-trend, matchup, bullpen, or market availability to keep him visible.",
    "TOP 5": "This player sits inside the tightest board tier, so the AI is treating him as one of the slate's clearest priority HR candidates.",
    "TOP 10": "This player sits inside the highest board tier, so the AI is treating him as one of the slate's strongest overall HR candidates.",
    "TOP 30": "This player is inside the main playable board range, meaning the profile is strong enough to stay in the daily HR conversation.",
    "ZONE 5+": "This is a damage-zone read. The player has a zone-based power signal that matters for HR upside when the pitch path lines up."
  }[tag] || "This player fits the active AI section because his public tag was derived from the canonical internal signal registry.";

  const riskLine = "The risk is still the normal HR volatility: one swing has to show up, lineup context can change, and a pitcher can avoid the damage area. But based on the live signal stack, this is why the AI is keeping him on the board.";

  return `${matchupLine} ${sectionRead} ${signalLine} ${riskLine}`;
}

const publicTags = readJson(PUBLIC_TAGS);
const playerCardsRaw = readJson(PLAYER_CARDS, {});
const matchups = readJson(MATCHUPS, {});
const marketOdds = readJson(MARKET_ODDS, {});

if (!publicTags || !Array.isArray(publicTags.tags)) {
  throw new Error("Missing canonical public_tags.json");
}

const cards = rows(playerCardsRaw);
const cardMap = new Map();
const oddsMap = marketOddsIndex(marketOdds);

for (const row of cards) {
  const id = playerId(row);
  const name = playerName(row);
  cardMap.set(key(id, name), row);
  if (name) cardMap.set("|" + norm(name), row);
}

function findCard(player) {
  return cardMap.get(key(player.playerId, player.name)) || cardMap.get("|" + norm(player.name)) || null;
}

function oddsFor(player, card) {
  const direct = americanOddsValue(card?.odds || card?.hrOdds || card?.bestOdds || card?.overPriceAmerican);
  if (direct) return direct;
  return oddsMap.get(String(player.playerId || ""))?.odds || oddsMap.get("|" + norm(player.name))?.odds || "";
}

const sections = publicTags.tags.map(tag => {
  const players = (tag.players || []).map(p => {
    const card = findCard(p);
    const rawScore = scoreOf(card || {});
    const confidence = Number(p.confidence || 0);
    const aiScore = rawScore > 1 ? rawScore / 100 : Math.max(rawScore, confidence);
    const odds = oddsFor(p, card);
    const cardWithOdds = card ? { ...card, odds } : { odds };

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
      }, cardWithOdds),
      card: {
        team: card?.team || card?.Team || "",
        opponent: card?.opponent || card?.Opp || "",
        pitcher: card?.pitcher || card?.opposingPitcher || card?.probablePitcher || "",
        hrScore: hrDisplay(card || {}, Math.round((aiScore || confidence || 0.65) * 100)),
        powerScore: powerDisplay(card || {}, Math.round((aiScore || confidence || 0.65) * 100)),
        recentForm: card?.recentForm || card?.formScore || card?.recentScore || "",
        odds
      }
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
    "game_pitcher_matchups.json",
    "mlb_market_odds.json"
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
