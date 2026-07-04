const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const OUT = path.join(DATA, "tag_registry.json");

const SOURCES = [
  "unified_player_tags.json",
  "player_card_data.json",
  "advanced_player_intelligence.json",
  "hr_decision_center.json",
  "lineup_impact_engine.json",
  "hr_probability_tracking.json",
  "hr_power_profiles.json",
  "mlb_home_runs.json",
  "bullpen_relievers.json",
  "hr_chain_reaction.json",
  "ai_trust_engine.json"
];

function readJson(file) {
  const full = path.join(DATA, file);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function normalizeTag(tag) {
  if (tag === null || tag === undefined) return "";
  if (typeof tag === "object") {
    return normalizeTag(
      tag.tag ||
      tag.name ||
      tag.label ||
      tag.title ||
      tag.value ||
      tag.type ||
      ""
    );
  }

  return String(tag || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function prettyName(row) {
  return (
    row.playerName ||
    row.name ||
    row.player ||
    row.batterName ||
    row.hitterName ||
    row.fullName ||
    row.Player ||
    null
  );
}

function playerId(row) {
  return (
    row.playerId ||
    row.mlbId ||
    row.id ||
    row.batterId ||
    row.hitterId ||
    row.mlb_id ||
    null
  );
}

function collectRows(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  const out = [];

  for (const key of [
    "players",
    "rows",
    "data",
    "board",
    "items",
    "hitters",
    "batters",
    "profiles",
    "rankings",
    "picks"
  ]) {
    if (Array.isArray(data[key])) out.push(...data[key]);
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === "object") out.push(row);
      }
    } else if (value && typeof value === "object") {
      const name = prettyName(value);
      if (name) out.push(value);
    }
  }

  return out;
}

function addRawTag(found, value) {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const item of value) addRawTag(found, item);
    return;
  }

  if (typeof value === "object") {
    addRawTag(
      found,
      value.tag ||
      value.name ||
      value.label ||
      value.title ||
      value.value ||
      value.type ||
      ""
    );
    return;
  }

  String(value)
    .split(/•|\||,|;/g)
    .map(normalizeTag)
    .filter(Boolean)
    .forEach(t => found.push(t));
}

function extractTags(row) {
  const found = [];

  for (const [key, value] of Object.entries(row || {})) {
    const k = key.toLowerCase();

    if (
      k.includes("tag") ||
      k.includes("tier") ||
      k.includes("label") ||
      k.includes("badge") ||
      k.includes("signal") ||
      k.includes("edge")
    ) {
      addRawTag(found, value);
    }
  }

  return [...new Set(found)]
    .filter(t =>
      t &&
      t !== "N/A" &&
      t !== "NONE" &&
      t !== "NULL" &&
      t !== "[OBJECT OBJECT]" &&
      !/^\[OBJECT/.test(t) &&
      !/^\d+(\.\d+)?$/.test(t) &&
      t.length <= 60
    );
}

function inferCategory(tag) {
  if (/POWER|HR|BOMB|SLG|BARREL|HARD/.test(tag)) return "power";
  if (/PITCH|PITCHER|LEAK|VULNER|ARSENAL/.test(tag)) return "pitcher";
  if (/FORM|HOT|HEATER|TREND|RECENT/.test(tag)) return "form";
  if (/VALUE|ODDS|MARKET|LONGSHOT/.test(tag)) return "market";
  if (/WIND|WEATHER|PARK|ENVIRONMENT/.test(tag)) return "environment";
  if (/LINEUP|TRAFFIC|RBI|ORDER/.test(tag)) return "lineup";
  if (/BULLPEN|RELIEF/.test(tag)) return "bullpen";
  if (/MODEL|AI|TRUST|CONFIDENCE/.test(tag)) return "model";
  return "general";
}

function confidenceFrom(row) {
  const vals = [
    row.confidence,
    row.aiConfidence,
    row.modelConfidence,
    row.trustScore,
    row.score,
    row.hrScore,
    row.powerScore
  ]
    .map(Number)
    .filter(Number.isFinite);

  if (!vals.length) return 0.65;

  const best = Math.max(...vals);
  if (best > 1) return Math.max(0, Math.min(1, best / 100));
  return Math.max(0, Math.min(1, best));
}

const registry = new Map();

for (const source of SOURCES) {
  const data = readJson(source);
  const rows = collectRows(data);

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const name = prettyName(row);
    const id = playerId(row);
    const tags = extractTags(row);

    for (const tag of tags) {
      if (!registry.has(tag)) {
        registry.set(tag, {
          tag,
          description: `${tag} signal harvested from live MLB intelligence engines.`,
          category: inferCategory(tag),
          players: [],
          count: 0,
          confidence: 0,
          source: []
        });
      }

      const entry = registry.get(tag);

      if (!entry.source.includes(source)) entry.source.push(source);

      if (name || id) {
        const key = `${id || ""}|${name || ""}`;
        if (!entry.players.some(p => p.key === key)) {
          entry.players.push({
            key,
            playerId: id,
            name,
            confidence: confidenceFrom(row),
            source
          });
        }
      }
    }
  }
}

const tags = [...registry.values()]
  .map(entry => {
    const players = entry.players.map(({ key, ...p }) => p);
    const avg =
      players.length
        ? players.reduce((sum, p) => sum + Number(p.confidence || 0), 0) / players.length
        : 0;

    return {
      tag: entry.tag,
      description: entry.description,
      category: entry.category,
      players,
      count: players.length,
      confidence: Number(avg.toFixed(3)),
      source: entry.source.sort()
    };
  })
  .filter(entry => entry.count > 0)
  .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

const output = {
  generatedAt: new Date().toISOString(),
  sourceType: "live_mlb_engine_outputs",
  canonical: true,
  totalTags: tags.length,
  totalTaggedPlayers: new Set(
    tags.flatMap(t => t.players.map(p => p.playerId || p.name).filter(Boolean))
  ).size,
  tags
};

fs.writeFileSync(OUT, JSON.stringify(output, null, 2));
console.log(`Built ${OUT}`);
console.log(`Tags: ${output.totalTags}`);
console.log(`Tagged players: ${output.totalTaggedPlayers}`);
