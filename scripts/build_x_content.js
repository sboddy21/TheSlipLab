import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website/data");
const CONTENT_DIR = path.join(DATA, "content");
const EXPORT_DIR = path.join(ROOT, "exports/content");

const OUT_JSON = path.join(CONTENT_DIR, "x_posts.json");
const OUT_QUEUE = path.join(CONTENT_DIR, "x_daily_queue.json");
const OUT_TXT = path.join(EXPORT_DIR, "x_posts.txt");
const HISTORY_FILE = path.join(CONTENT_DIR, "x_post_history.json");

fs.mkdirSync(CONTENT_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

const TODAY = new Date().toISOString().slice(0, 10);
const NOW = new Date().toISOString();

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function uniqBy(list, keyFn) {
  const seen = new Set();
  return list.filter(item => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function name(r) {
  return clean(r.name || r.player || r.playerName || r.batter || r.hitter || r.fullName || "Unknown");
}

function team(r) {
  return clean(r.team || r.teamAbbr || r.batterTeam || r.playerTeam || r.club || "");
}

function score(r) {
  return num(
    r.hrConfidence ??
    r.currentScore ??
    r.bestScore ??
    r.stackScore ??
    r.consensusScore ??
    r.score ??
    r.hrScore ??
    r.modelScore ??
    r.finalScore ??
    r.aiScore ??
    r.valueScore ??
    r.hrProbabilityScore ??
    0
  );
}

function odds(r) {
  return clean(r.odds || r.bestOdds || r.hrOdds || r.price || "");
}

function shortPlayer(r) {
  const t = team(r);
  const o = odds(r);
  const s = score(r);
  let out = t ? `${name(r)} (${t})` : name(r);
  if (s) out += ` | ${s.toFixed(1)}`;
  if (o) out += ` | ${o}`;
  return out;
}

function oneLinePlayer(r) {
  const t = team(r);
  return t ? `${name(r)} (${t})` : name(r);
}

function normalizeText(text) {
  return clean(text)
    .toLowerCase()
    .replace(/[0-9]+(\.[0-9]+)?/g, "#")
    .replace(/[^a-z# ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(text) {
  return normalizeText(text).split(" ").filter(Boolean).slice(0, 42).join(" ");
}

function similarity(a, b) {
  const A = new Set(normalizeText(a).split(" ").filter(Boolean));
  const B = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hits = 0;
  for (const x of A) if (B.has(x)) hits++;
  return hits / Math.max(A.size, B.size);
}

function recentHistory(history, days = 14) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return arr(history.posts).filter(p => {
    const t = Date.parse(p.createdAt || p.date || "");
    return Number.isFinite(t) ? t >= cutoff : true;
  });
}

function tooSimilar(text, recent) {
  return recent.some(p => similarity(text, p.text || "") >= 0.56);
}

function trimPost(text) {
  const t = clean(text);
  if (t.length <= 278) return t;
  return t.slice(0, 275).replace(/\s+\S*$/, "") + "...";
}

function sectionRows(decision, key) {
  const s = decision.sections?.[key];
  if (Array.isArray(s)) return s;
  if (Array.isArray(s?.picks)) return s.picks;
  if (Array.isArray(s?.picks)) return s.picks;
  if (Array.isArray(s?.players)) return s.players;
  if (Array.isArray(s?.rows)) return s.rows;
  return [];
}

function topRows(...groups) {
  return uniqBy(groups.flat().filter(Boolean), r => name(r).toLowerCase())
    .sort((a, b) => score(b) - score(a));
}

const decision = readJson(path.join(DATA, "hr_decision_center.json"), {});
const hrBoard = readJson(path.join(DATA, "mlb_home_runs.json"), {});
const weather = readJson(path.join(DATA, "mlb_weather.json"), {});
const ai = readJson(path.join(DATA, "hr_ai_breakdowns.json"), {});
const stacks = readJson(path.join(DATA, "hr_ai_stacks.json"), {});
const movement = readJson(path.join(DATA, "hr_ai_movement.json"), {});
const hof = readJson(path.join(DATA, "hr_ai_hof.json"), {});
const history = readJson(HISTORY_FILE, { posts: [], weather: [] });
const recent = recentHistory(history, 14);

const allPlayers = topRows(
  arr(decision.allPlayers),
  arr(hrBoard),
  arr(hrBoard.players),
  arr(hrBoard.rows),
  arr(hrBoard.allPlayers)
);

const best = topRows(sectionRows(decision, "bestPicks"), sectionRows(decision, "ifOnlyOne"), allPlayers).slice(0, 20);
const onePick = topRows(sectionRows(decision, "ifOnlyOne"), best).slice(0, 8);
const value = topRows(sectionRows(decision, "bestValue"), sectionRows(decision, "lottoBombs")).slice(0, 12);
const safe = topRows(sectionRows(decision, "safestPlays"), best).slice(0, 12);
const bullpen = topRows(sectionRows(decision, "bullpenBoosts")).slice(0, 12);
const pitch = topRows(sectionRows(decision, "pitchTypeEdges"), sectionRows(decision, "pitchTypeDestruction")).slice(0, 12);
const lotto = topRows(sectionRows(decision, "lottoBombs"), value).slice(0, 12);
const aiRows = topRows(arr(ai.players), arr(ai.rows), arr(ai.breakdowns)).slice(0, 20);
const risers = topRows(arr(movement.risers), arr(movement.biggestRisers)).slice(0, 10);
const hofRows = topRows(arr(hof.goatBoard), arr(hof.leaderboard), arr(hof.players), arr(hof.rows)).slice(0, 10);
const stackRows = arr(stacks.stacks || stacks.rows).slice(0, 8);

function add(candidates, type, slot, weight, text, entities = [], meta = {}) {
  const finalText = trimPost(text);
  if (!finalText || finalText.length < 40) return;
  candidates.push({
    id: `${TODAY}-${type}-${candidates.length + 1}`,
    date: TODAY,
    createdAt: NOW,
    type,
    slot,
    weight,
    text: finalText,
    post: finalText,
    entities: entities.map(clean).filter(Boolean),
    fingerprint: fingerprint(finalText),
    ...meta
  });
}

function buildWeatherEdges() {
  const rows = arr(weather.games || weather.rows || weather.venues || weather.parks || weather.weather);
  return rows.map(g => {
    const park = clean(g.park || g.stadium || g.venue || g.ballpark || g.name);
    const game = clean(g.game || g.matchup || g.awayHome || "");
    const temp = num(g.temp ?? g.temperature ?? g.gameTemp);
    const wind = num(g.windSpeed ?? g.wind_mph ?? g.windMph ?? g.wind ?? g.windSpeedMph);
    const dir = clean(g.windDirection || g.wind_dir || g.windText || g.windDescription || "");
    const carry = num(g.carryScore ?? g.weatherScore ?? g.hrWeatherScore ?? g.score);
    const dome = Boolean(g.dome || g.isDome || /dome|roof/i.test(clean(g.roof || g.condition)));
    const edge = carry + Math.max(0, wind - 9) * 3.2 + Math.max(0, temp - 78) * 1.3 - (dome ? 20 : 0);

    return { park, game, temp, wind, dir, carry, dome, edge };
  })
    .filter(g => g.park && !g.dome)
    .filter(g => g.wind >= 12 || g.temp >= 84 || g.carry >= 72 || g.edge >= 82)
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 5);
}

function weatherSignature(edges) {
  return edges.map(g => {
    const tempBucket = Math.round(g.temp / 5) * 5;
    const windBucket = Math.round(g.wind / 3) * 3;
    const dirKey = g.dir.toLowerCase().replace(/[^a-z]/g, "").slice(0, 10);
    return `${g.park}:${tempBucket}:${windBucket}:${dirKey}`;
  }).join("|");
}

function weatherChanged(sig) {
  if (!sig) return false;
  const recentWeather = arr(history.weather).slice(0, 14);
  return !recentWeather.some(w => w.signature === sig);
}

const candidates = [];

if (best.length >= 3) {
  add(candidates, "model_top_3", "morning", 98,
`🧪 THE SLIP LAB READ

Top HR profiles today:

1. ${shortPlayer(best[0])}
2. ${shortPlayer(best[1])}
3. ${shortPlayer(best[2])}

Not locks. Just the cleanest power profiles on the slate.`,
  best.slice(0, 3).map(name));

  add(candidates, "board_separation", "morning", 93,
`Today's HR board has separation.

The model is not treating these bats the same:

• ${oneLinePlayer(best[0])}
• ${oneLinePlayer(best[1])}
• ${oneLinePlayer(best[2])}

When the gap is real, I want to know it early.`,
  best.slice(0, 3).map(name));

  add(candidates, "no_force_board", "evening", 72,
`Reminder before first pitch:

The board is a filter, not a permission slip.

Best profiles:
1. ${oneLinePlayer(best[0])}
2. ${oneLinePlayer(best[1])}
3. ${oneLinePlayer(best[2])}

Use the edge. Do not force the bet.`,
  best.slice(0, 3).map(name));
}

if (onePick.length >= 1) {
  add(candidates, "if_only_one", "morning", 100,
`🚀 IF I HAD TO PICK ONE

${shortPlayer(onePick[0])}

The profile checks the most boxes today:
• Power path
• Model score
• Slate separation

One lean. Not twenty guesses.`,
  [name(onePick[0])]);

  add(candidates, "single_bullet", "afternoon", 88,
`One hitter the model keeps pulling me back to:

${shortPlayer(onePick[0])}

Sometimes the best answer is not adding more names.

It is knowing which name belongs at the top.`,
  [name(onePick[0])]);
}

if (value.length >= 3) {
  add(candidates, "value_watch", "morning", 86,
`💰 VALUE WATCH

The model likes the number more than the market may realize:

1. ${shortPlayer(value[0])}
2. ${shortPlayer(value[1])}
3. ${shortPlayer(value[2])}

Price matters. Always.`,
  value.slice(0, 3).map(name));

  add(candidates, "market_misprice", "afternoon", 79,
`The most interesting part of today's board might be value.

Not just who can homer.

Who is priced like they cannot.

• ${oneLinePlayer(value[0])}
• ${oneLinePlayer(value[1])}
• ${oneLinePlayer(value[2])}`,
  value.slice(0, 3).map(name));
}

if (safe.length >= 3) {
  add(candidates, "safe_profiles", "morning", 76,
`🛡️ CLEANER HR PROFILES

Nothing is safe in HR betting.

But these are the steadier profiles today:

1. ${shortPlayer(safe[0])}
2. ${shortPlayer(safe[1])}
3. ${shortPlayer(safe[2])}

Cleaner path. Less noise.`,
  safe.slice(0, 3).map(name));
}

if (bullpen.length >= 3) {
  add(candidates, "bullpen_boost", "afternoon", 80,
`🔥 BULLPEN WATCH

The matchup does not end when the starter leaves.

Late-game boost names:

1. ${shortPlayer(bullpen[0])}
2. ${shortPlayer(bullpen[1])}
3. ${shortPlayer(bullpen[2])}

Nine innings matter.`,
  bullpen.slice(0, 3).map(name));

  add(candidates, "late_game_angle", "evening", 74,
`Late-game HR angle:

If these starters exit early, the model likes the damage path for:

• ${oneLinePlayer(bullpen[0])}
• ${oneLinePlayer(bullpen[1])}
• ${oneLinePlayer(bullpen[2])}

Bullpens turn good spots into great ones.`,
  bullpen.slice(0, 3).map(name));
}

if (pitch.length >= 3) {
  add(candidates, "pitch_type_edge", "afternoon", 84,
`🎯 PITCH TYPE EDGE

Today's best pitch-mix fits:

1. ${shortPlayer(pitch[0])}
2. ${shortPlayer(pitch[1])}
3. ${shortPlayer(pitch[2])}

This is why the matchup matters more than the name.`,
  pitch.slice(0, 3).map(name));

  add(candidates, "arsenal_problem", "evening", 77,
`A pitcher can look fine overall and still have the wrong arsenal today.

Pitch-type problem bats:

• ${oneLinePlayer(pitch[0])}
• ${oneLinePlayer(pitch[1])}
• ${oneLinePlayer(pitch[2])}`,
  pitch.slice(0, 3).map(name));
}

if (lotto.length >= 3) {
  add(candidates, "lotto_bombs", "afternoon", 70,
`💣 LOTTO BOMBS

Not the safest board.

The ceiling board:

1. ${shortPlayer(lotto[0])}
2. ${shortPlayer(lotto[1])}
3. ${shortPlayer(lotto[2])}

These are the fun ones, not the comfortable ones.`,
  lotto.slice(0, 3).map(name));
}

if (aiRows.length >= 3) {
  add(candidates, "ai_says", "afternoon", 87,
`🤖 AI SAYS

Three bats the model is not ignoring today:

1. ${shortPlayer(aiRows[0])}
2. ${shortPlayer(aiRows[1])}
3. ${shortPlayer(aiRows[2])}

The goal is not more picks.

The goal is smarter picks.`,
  aiRows.slice(0, 3).map(name));

  add(candidates, "model_flag", "morning", 75,
`Model flag for today's slate:

${oneLinePlayer(aiRows[0])} keeps showing up across the data.

That does not mean automatic bet.

It means do not scroll past the profile.`,
  [name(aiRows[0])]);
}

if (risers.length >= 3) {
  add(candidates, "risers", "morning", 82,
`📈 RISERS

Biggest upward movers in the HR model:

1. ${shortPlayer(risers[0])}
2. ${shortPlayer(risers[1])}
3. ${shortPlayer(risers[2])}

Movement matters when the slate changes.`,
  risers.slice(0, 3).map(name));
}

if (hofRows.length >= 3) {
  add(candidates, "goat_board", "evening", 66,
`🐐 SLIP LAB GOAT BOARD

Long-term model respect list:

1. ${shortPlayer(hofRows[0])}
2. ${shortPlayer(hofRows[1])}
3. ${shortPlayer(hofRows[2])}

Daily edges matter.

Track record matters too.`,
  hofRows.slice(0, 3).map(name));
}

if (stackRows.length >= 2) {
  const s1 = clean(stackRows[0].team || stackRows[0].name || stackRows[0].game || "Stack 1");
  const s2 = clean(stackRows[1].team || stackRows[1].name || stackRows[1].game || "Stack 2");

  add(candidates, "stack_watch", "afternoon", 68,
`🧬 STACK WATCH

Best HR environments from the stack engine:

1. ${s1}
2. ${s2}

Sometimes the edge is not one hitter.

Sometimes it is the whole environment.`,
  [s1, s2]);
}

const weatherEdges = buildWeatherEdges();
const wSig = weatherSignature(weatherEdges);

if (weatherEdges.length >= 2 && weatherChanged(wSig)) {
  add(candidates, "weather_edge", "morning", 73,
`🌤️ WEATHER EDGE WATCH

Only posting this because today's conditions actually stand out.

${weatherEdges.slice(0, 3).map((g, i) => `${i + 1}. ${g.park} | ${g.temp || "?"}° | ${g.wind || "?"} mph ${g.dir}`.trim()).join("\n")}

Weather amplifies power. It does not create it.`,
  weatherEdges.map(g => g.park),
  { weatherSignature: wSig });
}

const extraStyles = [
  ["slate_note", "morning", 71, `Slate note:\n\nThe top of the HR board is tighter than usual today.\n\nThat usually means I care more about price, lineup spot, and weather before locking anything in.`],
  ["discipline", "evening", 64, `Do not confuse a long list with an edge.\n\nThe model can rank 390 bats.\n\nThe job is finding the few that actually separate.`],
  ["process", "afternoon", 63, `The Slip Lab process today:\n\n1. Build the slate\n2. Score every bat\n3. Check weather\n4. Check pitcher path\n5. Check price\n6. Cut the noise\n\nThat last step is the hardest.`],
  ["anti_chalk", "afternoon", 61, `A popular name is not automatically a good bet.\n\nA quiet name is not automatically a bad one.\n\nThe model only cares about the profile.`],
  ["market_note", "morning", 60, `Early board rule:\n\nIf the number moves but the profile does not improve, I do not chase it.\n\nBetter to miss a play than force a bad price.`],
  ["final_check", "evening", 67, `Final check before betting HRs:\n\nConfirmed lineup matters.\nBatting spot matters.\nWeather matters.\nPrice matters.\n\nThe name alone is not enough.`]
];

for (const [type, slot, weight, text] of extraStyles) {
  add(candidates, type, slot, weight, text, []);
}

const STYLE_COUNT = 40;

const filtered = candidates
  .map(p => ({
    ...p,
    text: trimPost(p.text),
    post: trimPost(p.text),
    fingerprint: fingerprint(trimPost(p.text))
  }))
  .filter(p => p.text.length >= 40)
  .filter(p => !tooSimilar(p.text, recent))
  .sort((a, b) => b.weight - a.weight);

const selected = [];
const usedTypes = new Set();
const usedEntities = new Map();

function entityAllowed(p) {
  for (const e of p.entities || []) {
    const key = e.toLowerCase();
    if ((usedEntities.get(key) || 0) >= 2) return false;
  }
  return true;
}

function takeForSlot(slot, count) {
  for (const p of filtered) {
    if (selected.length >= 12) break;
    if (selected.filter(x => x.slot === slot).length >= count) break;
    if (selected.some(x => x.text === p.text)) continue;
    if (usedTypes.has(p.type)) continue;
    if (!entityAllowed(p)) continue;

    selected.push(p);
    usedTypes.add(p.type);
    for (const e of p.entities || []) {
      const key = e.toLowerCase();
      usedEntities.set(key, (usedEntities.get(key) || 0) + 1);
    }
  }
}

takeForSlot("morning", 4);
takeForSlot("afternoon", 4);
takeForSlot("evening", 4);

for (const p of filtered) {
  if (selected.length >= 12) break;
  if (selected.some(x => x.text === p.text)) continue;
  selected.push(p);
}

if (selected.length === 0) {
  const fallbackRows = best.length ? best : allPlayers.slice(0, 12);

  for (const r of fallbackRows.slice(0, 8)) {
    selected.push({
      id: `${TODAY}-fallback-${selected.length + 1}`,
      date: TODAY,
      createdAt: NOW,
      slot: selected.length < 3 ? "morning" : selected.length < 6 ? "afternoon" : "evening",
      type: "fallback_model_note",
      weight: 50,
      text: trimPost(`🧪 SLIP LAB MODEL NOTE\n\n${shortPlayer(r)} is one of the stronger HR profiles on today's board.\n\nNot a lock. Just a profile worth checking before first pitch.`),
      post: "",
      entities: [name(r)],
      fingerprint: ""
    });
  }
}

const finalPosts = selected.slice(0, 12).map((p, i) => ({
  id: `${TODAY}-${String(i + 1).padStart(2, "0")}`,
  date: TODAY,
  createdAt: NOW,
  slot: p.slot,
  type: p.type,
  text: p.text,
  post: p.text,
  weight: p.weight,
  entities: p.entities || [],
  fingerprint: p.fingerprint,
  weatherSignature: p.weatherSignature || ""
}));

const queue = {
  updatedAt: NOW,
  date: TODAY,
  version: "Content Engine 2.0",
  count: finalPosts.length,
  styleLibrarySize: STYLE_COUNT,
  rules: [
    "ES Module compatible",
    "Tracks recent post history",
    "Blocks highly similar posts from last 14 days",
    "Weather posts require a real edge and a changed weather signature",
    "Rotates morning, afternoon, and evening queue slots",
    "Chooses strongest stories instead of fixed template order"
  ],
  morning: finalPosts.filter(p => p.slot === "morning"),
  afternoon: finalPosts.filter(p => p.slot === "afternoon"),
  evening: finalPosts.filter(p => p.slot === "evening"),
  posts: finalPosts
};

writeJson(OUT_JSON, queue);
writeJson(OUT_QUEUE, queue);

fs.writeFileSync(
  OUT_TXT,
  finalPosts.map((p, i) => `POST ${i + 1} | ${p.slot.toUpperCase()} | ${p.type}\n${p.text}`).join("\n\n---\n\n")
);

const nextHistoryPosts = [
  ...finalPosts.map(p => ({
    date: TODAY,
    createdAt: NOW,
    type: p.type,
    slot: p.slot,
    text: p.text,
    fingerprint: p.fingerprint,
    entities: p.entities || []
  })),
  ...arr(history.posts)
].slice(0, 400);

const nextWeather = [
  ...finalPosts
    .filter(p => p.weatherSignature)
    .map(p => ({
      date: TODAY,
      createdAt: NOW,
      signature: p.weatherSignature,
      text: p.text
    })),
  ...arr(history.weather)
].slice(0, 60);

writeJson(HISTORY_FILE, {
  updatedAt: NOW,
  posts: nextHistoryPosts,
  weather: nextWeather
});

console.log("CONTENT ENGINE 2.0 COMPLETE");
console.log("Posts:", finalPosts.length);
console.log("Morning:", queue.morning.length);
console.log("Afternoon:", queue.afternoon.length);
console.log("Evening:", queue.evening.length);
console.log("Weather posted:", finalPosts.some(p => p.type === "weather_edge") ? "YES" : "NO");
console.log("Saved:", OUT_JSON);
console.log("Export:", OUT_TXT);
