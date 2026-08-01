import "dotenv/config";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = path.join(ROOT, "website/data");
const OUTPUT = path.join(ROOT, "website/data/video");
const PUBLIC = path.join(ROOT, "public/generated");
const reuseRender = process.argv.includes("--validate-existing");
const voiceSample = process.argv.includes("--voice-sample");
const mode = process.argv.includes("--render") || reuseRender ? "render" : process.argv.includes("--preview") ? "preview" : "dry-run";
const fps = 30;

const sources = {
  health: "health_status.json", games: "mlb_games_today.json", cards: "player_card_data.json",
  probability: "hr_probability_tracking.json", ai: "ai_2.json", movement: "hr_ai_movement.json",
  weather: "mlb_weather.json", context: "mlb_context_factors.json", odds: "mlb_market_odds.json"
};
const read = name => JSON.parse(fs.readFileSync(path.join(DATA, sources[name]), "utf8"));
const docs = Object.fromEntries(Object.keys(sources).map(key => [key, read(key)]));
const generatedAt = new Date().toISOString();
const slateDate = docs.games.date;
const datedBase = `daily-mlb-rundown-${slateDate}`;
const warnings = [];

function spokenSlateDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ordinals = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first"];
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const lastTwo = year % 100;
  const spokenYear = year >= 2000 && year < 2100
    ? `twenty ${lastTwo < 10 ? `oh ${ones[lastTwo]}` : lastTwo === 10 ? "ten" : lastTwo === 11 ? "eleven" : lastTwo === 12 ? "twelve" : lastTwo === 13 ? "thirteen" : lastTwo === 14 ? "fourteen" : lastTwo === 15 ? "fifteen" : lastTwo === 16 ? "sixteen" : lastTwo === 17 ? "seventeen" : lastTwo === 18 ? "eighteen" : lastTwo === 19 ? "nineteen" : `twenty${ones[lastTwo - 20] ? `-${ones[lastTwo - 20]}` : ""}`}`
    : String(year);
  return `${months[month - 1]} ${ordinals[day]}, ${spokenYear}`;
}
const narrationDate = spokenSlateDate(slateDate);

function timestamp(doc) { return doc.generatedAt || doc.updatedAt || `${doc.date}T12:00:00Z`; }
function trace(source, field, value) { return { source: `website/data/${sources[source]}`, field, value }; }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function cleanText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function playerMap(list, key = "playerId") { return new Map(list.map(item => [String(item[key]), item])); }

const probabilityById = playerMap(docs.probability.players);
const movementById = playerMap([...(docs.movement.risers || []), ...(docs.movement.fallers || [])]);
const aiById = new Map();
for (const section of docs.ai.sections || []) for (const player of section.players || []) {
  if (!aiById.has(String(player.playerId))) aiById.set(String(player.playerId), player);
}

function enrich(card) {
  const probability = probabilityById.get(String(card.playerId));
  if (!probability) return null;
  const movement = movementById.get(String(card.playerId));
  const ai = aiById.get(String(card.playerId));
  const rank = probability.probabilityRank;
  const base = {
    playerId: card.playerId, name: card.player, team: card.team, opponent: card.opponent,
    game: card.game, pitcher: card.opposingPitcher, lineupStatus: card.lineupStatus,
    rank, realHrProbability: probability.realHrProbability, probabilityTier: probability.probabilityTier,
    confidence: card.model.score, powerScore: card.model.powerScore, pitchEdge: card.model.pitchEdge,
    pitcherRisk: card.model.pitcherRisk, zoneOverlap: card.model.zoneOverlap,
    hardHitScore: card.model.hardHitScore, barrelScore: card.model.barrelScore,
    dueSignal: card.model.due, weatherScore: card.model.weather, seasonHr: card.season.hr,
    last7Hr: card.last7.hr, last7Ops: card.last7.ops, tags: (card.tags || []).slice(0, 5),
    aiExplanation: cleanText(ai?.take)
  };
  if (ai?.card?.odds) base.odds = ai.card.odds;
  if (movement) base.movement = { scoreChange: movement.scoreChange, rankChange: movement.rankChange };
  base.sourceTrace = [
    trace("cards", `players[playerId=${card.playerId}].identity`, { player: card.player, team: card.team, opponent: card.opponent, game: card.game, opposingPitcher: card.opposingPitcher }),
    trace("cards", `players[playerId=${card.playerId}].model`, { score: card.model.score, powerScore: card.model.powerScore, pitchEdge: card.model.pitchEdge, pitcherRisk: card.model.pitcherRisk, zoneOverlap: card.model.zoneOverlap, hardHitScore: card.model.hardHitScore, barrelScore: card.model.barrelScore, due: card.model.due, weather: card.model.weather }),
    trace("cards", `players[playerId=${card.playerId}].last7`, { hr: card.last7.hr, ops: card.last7.ops }),
    trace("probability", `players[playerId=${card.playerId}]`, { probabilityRank: probability.probabilityRank, realHrProbability: probability.realHrProbability, probabilityTier: probability.probabilityTier })
  ];
  if (ai) base.sourceTrace.push(trace("ai", `sections[].players[playerId=${card.playerId}]`, { take: ai.take, odds: ai.card?.odds }));
  if (movement) base.sourceTrace.push(trace("movement", `risers|fallers[playerId=${card.playerId}]`, base.movement));
  return base;
}

const pool = docs.cards.players.map(enrich).filter(Boolean).sort((a, b) => a.rank - b.rank);
const top = pool.slice(0, 5);
const used = new Set(top.map(p => p.playerId));

function dueQualification(p) {
  const indicators = [];
  if (p.barrelScore >= 70) indicators.push({ label: "barrel quality", value: p.barrelScore, points: 18 });
  if (p.hardHitScore >= 70) indicators.push({ label: "hard-hit quality", value: p.hardHitScore, points: 18 });
  if (p.last7Hr === 0 && p.powerScore >= 60) indicators.push({ label: "results lagging power", value: `${p.last7Hr} HR / ${p.powerScore} power`, points: 16 });
  if (p.zoneOverlap >= 25) indicators.push({ label: "power-zone alignment", value: p.zoneOverlap, points: 14 });
  if (p.pitcherRisk >= 28) indicators.push({ label: "pitcher vulnerability", value: p.pitcherRisk, points: 12 });
  if ((p.movement?.rankChange || 0) > 0) indicators.push({ label: "model rank rising", value: p.movement.rankChange, points: 12 });
  if (p.weatherScore >= 15) indicators.push({ label: "supportive environment", value: p.weatherScore, points: 10 });
  return { score: indicators.reduce((sum, x) => sum + x.points, 0), indicators };
}
const due = pool.filter(p => !used.has(p.playerId)).map(p => ({ ...p, qualification: dueQualification(p) }))
  .filter(p => p.qualification.indicators.length >= 3 && p.qualification.score >= 48)
  .sort((a, b) => b.qualification.score - a.qualification.score || a.rank - b.rank).slice(0, 3);
due.forEach(p => used.add(p.playerId));

function sleeperQualification(p) {
  const indicators = [];
  if (p.rank >= 12 && p.rank <= 100) indicators.push({ label: "outside headline ranks", value: p.rank, points: 15 });
  if (p.pitchEdge >= 58) indicators.push({ label: "pitch-mix edge", value: p.pitchEdge, points: 20 });
  if (p.powerScore >= 55) indicators.push({ label: "power foundation", value: p.powerScore, points: 18 });
  if (p.pitcherRisk >= 28) indicators.push({ label: "pitcher vulnerability", value: p.pitcherRisk, points: 15 });
  if (p.zoneOverlap >= 25) indicators.push({ label: "zone alignment", value: p.zoneOverlap, points: 15 });
  if ((p.movement?.rankChange || 0) >= 10) indicators.push({ label: "positive model movement", value: p.movement.rankChange, points: 17 });
  return { score: indicators.reduce((sum, x) => sum + x.points, 0), indicators };
}
const sleepers = pool.filter(p => !used.has(p.playerId) && p.rank > 10).map(p => ({ ...p, qualification: sleeperQualification(p) }))
  .filter(p => p.qualification.indicators.length >= 3 && p.qualification.score >= 50)
  .sort((a, b) => b.qualification.score - a.qualification.score || a.rank - b.rank).slice(0, 3);
sleepers.forEach(p => used.add(p.playerId));

const movers = (docs.movement.risers || []).map(m => pool.find(p => p.playerId === m.playerId)).filter(Boolean)
  .filter(p => !used.has(p.playerId) && (p.movement?.rankChange || 0) > 0).slice(0, 2);

function playerSentence(p, category) {
  if (category === "top") return `${p.name} is number ${p.rank} on the calibrated board at ${p.realHrProbability} percent. The matchup is ${p.team} against ${p.opponent}, with ${p.pitcher} expected on the mound. A ${p.powerScore.toFixed(0)} power score and ${p.pitchEdge.toFixed(0)} pitch edge are the two cleanest reasons to pay attention. The model is identifying upside, not promising an outcome.`;
  const reasons = p.qualification.indicators.slice(0, 3).map(x => x.label).join(", ");
  if (category === "due") return `${p.name} qualifies as a due player through ${reasons}. He has ${p.last7Hr} home runs across the recent seven-game window, while the underlying contact and matchup scores remain supportive. The results have lagged behind the quality of the profile, which supports a rebound opportunity without guaranteeing one.`;
  return `${p.name} is the sleeper at rank ${p.rank}. The case comes from ${reasons}. His calibrated home-run probability is ${p.realHrProbability} percent, and the matchup against ${p.pitcher} gives the lower-ranked profile a legitimate path to upside.`;
}
const segments = [
  { id: "opening", title: "Daily MLB Rundown", durationSeconds: 28, text: `Welcome to The Slip Lab daily MLB rundown for ${narrationDate}. There are ${docs.games.gameCount} games on the board. We are focusing on the strongest calibrated home-run profiles, the players whose contact indicators are running ahead of recent results, and a few lower-ranked sleepers with explainable upside. Weather and odds are included only where today's verified files support them. Nothing here guarantees a home run; this is a clear read of the current model.` },
  { id: "top", title: "Top Players", durationSeconds: 132, text: `Let's start at the top of the board. ${top.map(p => playerSentence(p, "top")).join(" ")}` },
  { id: "due", title: "Due Players", durationSeconds: 78, text: `Now to the due group. Going homerless by itself is not enough. Each player needs several supported contact, power, zone, pitcher, movement, or environment indicators. ${due.map(p => playerSentence(p, "due")).join(" ")}` },
  { id: "sleepers", title: "Sleeper Players", durationSeconds: 78, text: `Here are the sleepers. These are not random names and none appeared in the top group. ${sleepers.map(p => playerSentence(p, "sleeper")).join(" ")}` },
  { id: "closing", title: "Model Movers & Closing", durationSeconds: 44, text: `Before we close, the meaningful model risers are ${movers.map(p => `${p.name}, up ${p.movement.rankChange} ranking spots`).join(", ") || "limited by today's qualification rules"}. The favorite overall target is ${top[0]?.name}. The favorite due profile is ${due[0]?.name || "not forced today"}, and the favorite sleeper is ${sleepers[0]?.name || "not forced today"}. Full rankings and detailed analysis are available at TheSlipLab.com. Use the data as information, manage risk, and enjoy the slate.` }
];
const wordCount = segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
if (wordCount < 650) warnings.push(`Narration is ${wordCount} words, below the preferred 650 because unsupported detail was not padded.`);
if (!docs.odds || docs.odds.availability !== "available") warnings.push("Verified odds are unavailable.");
if (!process.env.ELEVENLABS_API_KEY && !process.env.OPENAI_API_KEY && !process.argv.some(x => x.startsWith("--audio="))) warnings.push("No TTS key is configured; narration audio will be skipped unless manual narration is provided.");
if (due.length < 3) warnings.push(`Only ${due.length} Due Players qualified.`);
if (sleepers.length < 3) warnings.push(`Only ${sleepers.length} Sleeper Players qualified.`);

const scenePlan = mode === "preview"
  ? segments.map(s => ({ ...s, durationSeconds: Math.min(s.durationSeconds, s.id === "top" ? 12 : 7) }))
  : segments;
const video = { generatedAt, slateDate, mode, fps, width: mode === "preview" ? 960 : 1920, height: mode === "preview" ? 540 : 1080,
  sourceTimestamps: Object.fromEntries(Object.entries(docs).map(([k, v]) => [sources[k], timestamp(v)])),
  slate: { gameCount: docs.games.gameCount, weatherAvailable: (docs.weather.weather || []).length > 0 },
  selectedPlayers: { top, due, sleepers, movers }, narrationSegments: scenePlan,
  sceneDurations: Object.fromEntries(scenePlan.map(s => [s.id, s.durationSeconds])), warnings, validation: {} };

function validate() {
  const errors = [];
  if (docs.health.status !== "healthy" || docs.health.slateDate !== slateDate) errors.push("Main MLB refresh is not healthy for the slate date.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  if (slateDate !== today) errors.push(`Stale slate: ${slateDate}; expected ${today}.`);
  for (const [name, value] of Object.entries(video.sourceTimestamps)) {
    const age = Date.now() - Date.parse(value); if (!Number.isFinite(age) || age > 8 * 3600e3) errors.push(`Stale source: ${name}.`);
  }
  const selected = [...top, ...due, ...sleepers];
  if (new Set(selected.map(p => p.playerId)).size !== selected.length) errors.push("A player appears in multiple categories.");
  const slateIds = new Set(docs.cards.players.map(p => p.playerId));
  for (const p of selected) {
    if (!slateIds.has(p.playerId)) errors.push(`${p.name} is not on the current slate.`);
    if (!p.sourceTrace?.length) errors.push(`${p.name} has no source trace.`);
    if (!p.name || !p.pitcher || !p.game) errors.push(`${p.name || p.playerId} has no meaningful explanation context.`);
  }
  const serialized = JSON.stringify(video);
  if (/\b(?:null|undefined|NaN)\b/.test(serialized)) errors.push("Video data contains null, undefined, or NaN.");
  return errors;
}

await fsp.mkdir(OUTPUT, { recursive: true });
const artifactBase = mode === "render" ? datedBase : `${datedBase}-${mode}`;
const jsonPath = path.join(OUTPUT, `${artifactBase}.json`);
const textPath = path.join(OUTPUT, `${artifactBase}.txt`);
const reportPath = path.join(OUTPUT, `${artifactBase}-report.json`);
video.validation.errors = validate();
video.validation.valid = video.validation.errors.length === 0;
if (!video.validation.valid) throw new Error(video.validation.errors.join("\n"));
await fsp.writeFile(jsonPath, JSON.stringify(video, null, 2));
await fsp.writeFile(textPath, segments.map(s => `${s.title.toUpperCase()}\n\n${s.text}`).join("\n\n"));

function run(command, args, env = process.env) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", env }); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); }); }
let audio = { status: "skipped", reason: "No TTS key or manual audio supplied" };
const manualFlag = process.argv.find(x => x.startsWith("--audio="));
const musicFlag = process.argv.find(x => x.startsWith("--music="));
await fsp.mkdir(PUBLIC, { recursive: true });
if (manualFlag) {
  const source = path.resolve(ROOT, manualFlag.slice(8));
  const file = `narration${path.extname(source) || ".mp3"}`;
  await fsp.copyFile(source, path.join(PUBLIC, file)); audio = { status: "manual", source, file };
} else if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID && (mode !== "dry-run" || voiceSample)) {
  const file = voiceSample ? "elevenlabs-voice-sample.mp3" : "narration.mp3";
  const input = voiceSample ? segments[0].text : segments.map(s => s.text).join("\n\n");
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: input,
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
      voice_settings: {
        stability: Number(process.env.ELEVENLABS_STABILITY || 0.5),
        similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY_BOOST || 0.75),
        style: Number(process.env.ELEVENLABS_STYLE || 0.1),
        use_speaker_boost: true,
        speed: Number(process.env.ELEVENLABS_SPEED || 1)
      }
    })
  });
  if (!response.ok) throw new Error(`ElevenLabs TTS failed: ${response.status} ${await response.text()}`);
  await fsp.writeFile(path.join(PUBLIC, file), Buffer.from(await response.arrayBuffer()));
  audio = { status: "generated", provider: "ElevenLabs", model: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2", file };
} else if (process.env.OPENAI_API_KEY && (mode !== "dry-run" || voiceSample)) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: process.env.OPENAI_TTS_VOICE || "alloy", input: segments.map(s => s.text).join("\n\n"), response_format: "mp3" }) });
  if (!response.ok) throw new Error(`TTS failed: ${response.status} ${await response.text()}`);
  await fsp.writeFile(path.join(PUBLIC, "narration.mp3"), Buffer.from(await response.arrayBuffer())); audio = { status: "generated", provider: "OpenAI", file: "narration.mp3" };
}
if (musicFlag) {
  const source = path.resolve(ROOT, musicFlag.slice(8)); const file = `background${path.extname(source) || ".mp3"}`;
  await fsp.copyFile(source, path.join(PUBLIC, file)); audio.background = { status: "manual", source, file, volume: 0.08 };
}
video.audio = audio;
if (audio.file) {
  const { parseMedia } = await import("@remotion/media-parser");
  const { nodeReader } = await import("@remotion/media-parser/node");
  audio.durationSeconds = (await parseMedia({ src: path.join(PUBLIC, audio.file), reader: nodeReader, acknowledgeRemotionLicense: true, fields: { durationInSeconds: true } })).durationInSeconds;
  if (!finite(audio.durationSeconds)) throw new Error("Narration duration could not be determined.");
  const plannedDuration = scenePlan.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  if (!voiceSample && audio.durationSeconds > plannedDuration + 2) throw new Error(`Narration is ${audio.durationSeconds.toFixed(1)}s but the video is ${plannedDuration}s; increase the TTS rate or adjust scenes.`);
  if (!voiceSample && audio.durationSeconds < plannedDuration * 0.75) warnings.push(`Narration covers only ${audio.durationSeconds.toFixed(1)}s of a ${plannedDuration}s video.`);
}
if (voiceSample) {
  const samplePath = path.join(OUTPUT, "elevenlabs-voice-sample.mp3");
  await fsp.copyFile(path.join(PUBLIC, audio.file), samplePath);
  console.log(JSON.stringify({ valid: true, provider: audio.provider, model: audio.model, durationSeconds: audio.durationSeconds, samplePath }, null, 2));
  process.exit(0);
}
let render = { status: "skipped" };
if (mode !== "dry-run") {
  const propsPath = path.join(OUTPUT, `${datedBase}-${mode}-props.json`);
  await fsp.writeFile(propsPath, JSON.stringify(video));
  const mp4Path = path.join(OUTPUT, `${datedBase}${mode === "preview" ? "-preview" : ""}.mp4`);
  if (!reuseRender) await run("npx", ["remotion", "render", "video/index.jsx", "DailyMlbRundown", mp4Path, `--props=${propsPath}`, `--width=${video.width}`, `--height=${video.height}`, "--codec=h264", "--overwrite", "--log=error"]);
  if (!fs.existsSync(mp4Path)) throw new Error(`Rendered video is missing: ${mp4Path}`);
  const { getVideoMetadata } = await import("@remotion/renderer");
  const probe = (await getVideoMetadata(mp4Path)).durationInSeconds;
  const expected = scenePlan.reduce((n, s) => n + s.durationSeconds, 0);
  if (!fs.existsSync(mp4Path) || Math.abs(probe - expected) > 2) throw new Error(`Rendered duration ${probe}s does not match ${expected}s.`);
  render = { status: reuseRender ? "validated-existing" : "rendered", mp4Path, durationSeconds: probe, expectedSeconds: expected };
}
const report = { generatedAt, slateDate, mode, valid: true, selectedCounts: { top: top.length, due: due.length, sleepers: sleepers.length, movers: movers.length }, wordCount, audio, render, warnings, outputs: { jsonPath, textPath, reportPath } };
await fsp.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
