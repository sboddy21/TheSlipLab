import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const OUT_DIR = path.join(ROOT, "exports", "content");
const SITE_DIR = path.join(ROOT, "website", "data", "content");

const TXT_OUT = path.join(OUT_DIR, "x_daily_queue.txt");
const JSON_OUT = path.join(OUT_DIR, "x_daily_queue.json");
const SITE_JSON_OUT = path.join(SITE_DIR, "x_daily_queue.json");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SITE_DIR, { recursive: true });

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function clean(v) {
  return String(v ?? "").trim();
}

function num(v) {
  const n = Number(String(v ?? "").replace("%", "").replace("+", ""));
  return Number.isFinite(n) ? n : 0;
}

function arrayFrom(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.allPlayers)) return data.allPlayers;
  if (Array.isArray(data.players)) return data.players;
  if (Array.isArray(data.plays)) return data.plays;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.stacks)) return data.stacks;

  if (data.sections && typeof data.sections === "object") {
    return Object.values(data.sections).flatMap(v => {
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.players)) return v.players;
      if (v && Array.isArray(v.rows)) return v.rows;
      if (v && Array.isArray(v.plays)) return v.plays;
      return [];
    });
  }

  if (data.games && Array.isArray(data.games)) {
    return data.games.flatMap(g => {
      const parts = [];
      if (Array.isArray(g.players)) parts.push(...g.players);
      if (Array.isArray(g.plays)) parts.push(...g.plays);
      if (Array.isArray(g.homePlayers)) parts.push(...g.homePlayers);
      if (Array.isArray(g.awayPlayers)) parts.push(...g.awayPlayers);
      if (Array.isArray(g.batters)) parts.push(...g.batters);
      return parts;
    });
  }

  return [];
}

const hrDecision = readJson(path.join(ROOT, "website", "data", "hr_decision_center.json"));
const liveTracker = readJson(path.join(ROOT, "website", "data", "live_hr_tracker.json"));
const chainReaction = readJson(path.join(ROOT, "website", "data", "hr_chain_reaction.json"));
const teamStacks = readJson(path.join(ROOT, "website", "data", "mlb_team_stacks.json"));
const stackIntel = readJson(path.join(ROOT, "website", "data", "team_stack_intelligence_2.json"));

const rawPlayers = [
  ...arrayFrom(hrDecision),
  ...arrayFrom(liveTracker),
  ...arrayFrom(chainReaction)
];

const rawStacks = [
  ...arrayFrom(teamStacks),
  ...arrayFrom(stackIntel)
];

const seen = new Set();

const players = rawPlayers
  .map(r => ({
    player: clean(r.player || r.name || r.batter || r.playerName),
    team: clean(r.team || r.batterTeam || r.playerTeam),
    opponent: clean(r.opponent || r.opp),
    pitcher: clean(r.pitcher || r.opposingPitcher || r.probablePitcher),
    odds: clean(r.odds || r.bestOdds || r.hrOdds),
    score: num(r.score || r.hrScore || r.finalScore || r.modelScore || r.overallScore),
    edge: num(r.edge || r.modelEdge || r.ev),
    barrel: num(r.barrel || r.barrelRate || r.barrelPct),
    hardHit: num(r.hardHit || r.hardHitRate || r.hardHitPct),
    iso: num(r.iso || r.ISO),
    ev: num(r.avgEV || r.avgEv || r.exitVelocity),
    recentHr: num(r.recentHr || r.hrL10 || r.last10Hr),
    trend: clean(r.trend || r.recentForm || r.label || r.tag),
    pitcherAttack: num(r.pitcherAttack || r.pitcherAttackScore || r.pitcherDamageScore),
    park: num(r.park || r.parkScore || r.parkFactorScore),
    weather: num(r.weather || r.weatherScore || r.weatherBoost)
  }))
  .filter(r => r.player)
  .filter(r => {
    const key = `${r.player}|${r.team}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

function pick(list, count = 4) {
  return list.filter(r => r.player).slice(0, count);
}

function scorePower(r) {
  return r.score + r.barrel * 2 + r.hardHit + r.iso * 100 + r.ev;
}

function scoreMeatball(r) {
  return r.score + r.pitcherAttack * 2 + r.barrel + r.park + r.weather;
}

function scoreDue(r) {
  return r.score + r.hardHit + r.barrel + r.ev - r.recentHr * 10;
}

function scoreValue(r) {
  return r.score + r.edge * 3;
}

function reason(r, type) {
  if (type === "power") return "Barrel profile plus impact contact";
  if (type === "meatball") return `Pitcher attack spot${r.pitcher ? ` vs ${r.pitcher}` : ""}`;
  if (type === "due") return "Hard contact signals without the recent HR result";
  if (type === "hot") return "Recent form is flashing";
  if (type === "value") return `${r.odds ? `${r.odds} ` : ""}Model edge watch`;
  return "Model signal plus matchup fit";
}

function playerLines(list, type) {
  return list.map((r, i) => {
    const odds = r.odds ? ` ${r.odds}` : "";
    return `${i + 1}. ${r.player}${odds}\n${reason(r, type)}`;
  }).join("\n\n");
}

function makePost(category, hook, list, type, cta) {
  return {
    category,
    hook,
    text: `${hook}\n\n${playerLines(list, type)}\n\nLineups still matter. Final board comes later.\n\n${cta}`,
    players: list.map(p => p.player),
    created_at: new Date().toISOString()
  };
}

const posts = [];

const early = pick([...players].sort((a, b) => b.score - a.score), 4);
if (early.length) posts.push(makePost("early_hr_looks", "🚨 The Slip Lab Early HR Watch", early, "early", "Who is your favorite HR look today?"));

const power = pick([...players].sort((a, b) => scorePower(b) - scorePower(a)), 4);
if (power.length) posts.push(makePost("power_bats", "🔥 Power Bat Board", power, "power", "Which bat scares you the most today?"));

const meatball = pick([...players].sort((a, b) => scoreMeatball(b) - scoreMeatball(a)), 4);
if (meatball.length) posts.push(makePost("meatball_matchups", "⚠️ Meatball Matchup Alert", meatball, "meatball", "Would you take one of these straight or ladder them?"));

const due = pick([...players].sort((a, b) => scoreDue(b) - scoreDue(a)), 4);
if (due.length) posts.push(makePost("due_bats", "👀 Due For Damage", due, "due", "Who breaks through first?"));

const hot = pick([...players].filter(r => r.recentHr > 0 || /heater|hot|strong/i.test(r.trend)).sort((a, b) => b.score - a.score), 4);
if (hot.length) posts.push(makePost("hot_bats", "💣 Hot Bat Watch", hot, "hot", "Ride the heat or fade the public?"));

const value = pick([...players].sort((a, b) => scoreValue(b) - scoreValue(a)), 4);
if (value.length) posts.push(makePost("value_watch", "🧪 The Slip Lab Value Watch", value, "value", "Best number on the board?"));

const stackLines = rawStacks.slice(0, 4).map((s, i) => {
  const team = clean(s.team || s.name || s.stack || s.offense);
  const grade = clean(s.grade || s.label || s.stackGrade);
  const score = clean(s.score || s.stackScore || s.stack_score);
  return `${i + 1}. ${team}\n${grade || "Stack signal"}${score ? ` | Score ${score}` : ""}`;
}).filter(Boolean);

if (stackLines.length) {
  posts.push({
    category: "stack_alert",
    hook: "📈 Stack Alert Board",
    text: `📈 Stack Alert Board\n\n${stackLines.join("\n\n")}\n\nTeam context matters for HR props.\n\nWhich offense are you backing today?`,
    players: [],
    created_at: new Date().toISOString()
  });
}

const txt = posts.map(p => p.text).join("\n\n====================\n\n");

fs.writeFileSync(TXT_OUT, txt);
fs.writeFileSync(JSON_OUT, JSON.stringify(posts, null, 2));
fs.writeFileSync(SITE_JSON_OUT, JSON.stringify(posts, null, 2));

console.log("THE SLIP LAB X DAILY QUEUE V2 COMPLETE");
console.log("Raw players:", rawPlayers.length);
console.log("Usable players:", players.length);
console.log("Raw stacks:", rawStacks.length);
console.log("Posts:", posts.length);
console.log("Saved:", TXT_OUT);
