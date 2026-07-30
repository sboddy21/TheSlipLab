import fs from "fs";
import path from "path";
import { completedResultSlate } from "./mlb/result_slate_status.js";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const CONTENT = path.join(DATA, "content");
const EXPORTS = path.join(ROOT, "exports", "content");
const OUT_JSON = path.join(CONTENT, "x_posts.json");
const OUT_TXT = path.join(EXPORTS, "x_posts.txt");
const HISTORY_FILE = path.join(CONTENT, "x_post_history.json");
const SITE_URL = "https://thesliplab.com";

fs.mkdirSync(CONTENT, { recursive: true });
fs.mkdirSync(EXPORTS, { recursive: true });

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function one(value) { return num(value).toFixed(1); }
function arr(value) { return Array.isArray(value) ? value : []; }
function norm(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function easternDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function fingerprint(text) {
  return clean(text).toLowerCase().replace(/[0-9]+(?:\.[0-9]+)?/g, "#")
    .replace(/[^a-z# ]/g, "").split(/\s+/).filter(Boolean).slice(0, 60).join(" ");
}

function similarity(a, b) {
  const A = new Set(fingerprint(a).split(" ").filter(Boolean));
  const B = new Set(fingerprint(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const word of A) if (B.has(word)) shared++;
  return shared / Math.max(A.size, B.size);
}

function uniquePlayers(rows) {
  const used = new Set();
  return arr(rows).filter(row => {
    const key = norm(row?.player || row?.name);
    if (!key || used.has(key)) return false;
    used.add(key);
    return true;
  });
}

function reasonList(row, limit = 3) {
  return arr(row?.reasons).map(clean)
    .filter(reason => reason && !/projected unknown|unknown lineup/i.test(reason))
    .slice(0, limit);
}

function reasonSentence(row) {
  const reasons = reasonList(row, 3);
  if (!reasons.length) return "The profile is being driven by the current model signal rather than name value.";
  const sentence = reasons.length === 1
    ? reasons[0]
    : `${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}`;
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

function playerLine(row) {
  const pitchEdge = num(row.pitchEdge);
  const parts = [
    `${clean(row.player)} — ${one(row.hrConfidence)} HR confidence`,
    row.bestPitch ? `${clean(row.bestPitch)} matchup${pitchEdge > 0 && pitchEdge <= 100 ? ` ${one(pitchEdge)}` : ""}` : "",
    row.confirmedLineup && row.lineupSpot ? `confirmed batting ${row.lineupSpot}` : ""
  ].filter(Boolean);
  return parts.join(" | ");
}

const decision = readJson(path.join(DATA, "hr_decision_center.json"));
const vulnerability = readJson(path.join(DATA, "pitcher_vulnerability.json"));
const weather = readJson(path.join(DATA, "mlb_weather.json"));
const games = readJson(path.join(DATA, "mlb_games_today.json"));
const results = readJson(path.join(DATA, "mlb_results.json"));
const previousResults = readJson(path.join(DATA, "mlb_results_previous.json"));
const calibration = readJson(path.join(DATA, "hr_calibration_report.json"), {});
const resultsHistory = readJson(path.join(DATA, "hr_results_history.json"), { days: [] });
const aiHistory = readJson(path.join(DATA, "hr_ai_history.json"), { history: {} });
const ai2 = readJson(path.join(DATA, "ai_2.json"), { sections: [] });
const history = readJson(HISTORY_FILE, { posts: [] });

const allPlayers = uniquePlayers(decision.allPlayers)
  .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence));
const best = uniquePlayers(decision.sections?.bestPicks).slice(0, 8);
const value = uniquePlayers(decision.sections?.bestValue).slice(0, 8);
const confirmed = allPlayers.filter(row => row.confirmedLineup && num(row.lineupSpot) > 0)
  .sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence));
const pitchers = arr(vulnerability.pitchers).slice().sort((a, b) => num(b.vulnerability) - num(a.vulnerability));
const gameRows = arr(games.games);
const weatherRows = arr(weather.weather);
const homeRuns = results.date === easternDate() ? arr(results.homeRuns) : [];

function latestPregameSnapshot(result) {
  const gameStart = Date.parse(result?.gameStartTime || "");
  if (!Number.isFinite(gameStart)) return null;
  const gamePk = num(result?.gamePk);
  const playerId = num(result?.playerId);
  if (!gamePk || !playerId) return null;

  return Object.values(aiHistory.history || {}).flatMap(arr)
    .filter(snapshot => {
      const timestamp = Date.parse(snapshot?.snapshotAt || snapshot?.timestamp || "");
      return snapshot?.verifiedPregame === true
        && num(snapshot?.gamePk) === gamePk
        && num(snapshot?.playerId) === playerId
        && Number.isFinite(timestamp)
        && timestamp < gameStart
        && snapshot?.slateDate === result?.date;
    })
    .sort((a, b) => Date.parse(b.snapshotAt || b.timestamp) - Date.parse(a.snapshotAt || a.timestamp))[0] || null;
}

function verifiedHit(result) {
  const snapshot = latestPregameSnapshot(result);
  if (!snapshot) return null;

  const grade = clean(snapshot.grade);
  const rank = num(snapshot.rank, 9999);
  const tier = ["A+", "A"].includes(grade) && rank <= 30
    ? "core"
    : grade === "B+" && rank >= 31 && rank <= 56 && num(snapshot.agreementCount) > 0
      ? "secondary"
      : null;

  return tier ? { result, snapshot, tier } : null;
}

const AI_SECTION_PRIORITY = [
  "TOP 5",
  "TOP 10",
  "TOP 30",
  "ELITE SMASH",
  "SMASH SPOT",
  "SMASH + PARK",
  "HOMER AI",
  "LIVE LONGSHOTS"
];
const ELIGIBLE_AI_SECTIONS = new Set(AI_SECTION_PRIORITY);
const EVENT_POST_TYPES = new Set(["called_it_home_run", "model_receipt", "slip_lab_hit_home_run", "live_longshot_hit"]);

function sectionPriority(section) {
  const index = AI_SECTION_PRIORITY.indexOf(section);
  return index === -1 ? AI_SECTION_PRIORITY.length : index;
}

function safeId(value) {
  return clean(value)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function playerKey(row) {
  return String(row?.playerId || row?.mlbId || row?.id || "");
}

function aiSectionsForResult(result) {
  const resultId = String(result?.playerId || "");
  const resultName = norm(result?.player || result?.batter);
  const matches = [];

  for (const section of arr(ai2.sections)) {
    const sectionName = clean(section?.title || section?.name || section?.category).toUpperCase();
    if (!ELIGIBLE_AI_SECTIONS.has(sectionName)) continue;

    const players = arr(section?.players || section?.items);
    players.forEach((player, index) => {
      const id = playerKey(player);
      const name = norm(player?.name || player?.player || player?.batter);
      if ((resultId && id && resultId === id) || (resultName && name && resultName === name)) {
        matches.push({
          section: sectionName,
          rank: index + 1,
          confidence: num(player?.confidence ?? player?.aiScore ?? player?.score, 0),
          aiScore: num(player?.aiScore ?? player?.score ?? player?.hrScore, 0)
        });
      }
    });
  }

  const seen = new Set();
  return matches
    .filter(item => {
      const key = `${item.section}:${item.rank}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => sectionPriority(a.section) - sectionPriority(b.section) || num(a.rank, 999) - num(b.rank, 999));
}

function decisionCenterRankForResult(result) {
  const resultId = String(result?.playerId || "");
  const resultName = norm(result?.player || result?.batter);
  const ranked = allPlayers
    .map((row, index) => ({ row, rank: index + 1 }))
    .find(({ row }) => {
      const id = String(row?.playerId || row?.mlbId || "");
      const name = norm(row?.player || row?.name);
      return (resultId && id && resultId === id) || (resultName && name && resultName === name);
    });

  if (!ranked || ranked.rank > 30) return null;
  return {
    section: "TOP 30",
    rank: ranked.rank,
    confidence: num(ranked.row?.hrConfidence, 0),
    aiScore: num(ranked.row?.hrConfidence, 0) / 100,
    row: ranked.row
  };
}

function eventIdForHomeRun(result, type = "called_it_home_run") {
  const date = clean(result?.date) || TODAY;
  const game = clean(result?.gamePk) || "game";
  const player = clean(result?.playerId) || norm(result?.player || result?.batter) || "player";
  const play = clean(result?.playId ?? result?.endTime ?? result?.description) || "play";
  return safeId(`${type}_${date}_${game}_${player}_${play}`);
}

function qualifiedHomeRun(result) {
  const snapshotHit = verifiedHit(result);
  const aiMemberships = aiSectionsForResult(result);
  const decisionRank = decisionCenterRankForResult(result);
  const memberships = aiMemberships.length
    ? aiMemberships
    : decisionRank
      ? [decisionRank]
      : [];

  if (!snapshotHit && !memberships.length) return null;

  const primary = memberships[0] || {
    section: snapshotHit.tier === "core" ? "TOP 30" : "HOMER AI",
    rank: num(snapshotHit.snapshot?.rank, 999),
    confidence: num(snapshotHit.snapshot?.confidence, 0),
    aiScore: num(snapshotHit.snapshot?.confidence, 0) / 100
  };

  return {
    result,
    snapshot: snapshotHit?.snapshot || null,
    tier: snapshotHit?.tier || "board",
    primary,
    memberships,
    qualifiedBy: [
      snapshotHit ? "verified_pregame_archive" : "",
      memberships.length ? "ai_says_current_board" : "",
      decisionRank ? "decision_center_top_30" : ""
    ].filter(Boolean)
  };
}

function allGamesFinal(payload) {
  return completedResultSlate(payload);
}

const recentPosts = arr(history.posts).filter(post => {
  const time = Date.parse(post.posted_at || post.createdAt || "");
  return post.status === "posted" && Number.isFinite(time) && time >= Date.now() - 14 * 86400000;
});

const candidates = [];
const TODAY = easternDate();
const NOW = new Date().toISOString();
const noGamesScheduled = games?.date === TODAY
  && Array.isArray(games?.games)
  && games.games.length === 0;
const noPublishableSlate = noGamesScheduled || allPlayers.length === 0;

function resultDaySummary(day) {
  const rows = arr(day?.homeRuns).filter(row => clean(row?.player || row?.batter));
  if (!rows.length) return null;

  const hardest = rows.slice().sort((a, b) => num(b.exitVelocity) - num(a.exitVelocity))[0];
  const longest = rows.slice().sort((a, b) => num(b.distance) - num(a.distance))[0];
  const pitchCounts = new Map();
  for (const row of rows) {
    const pitch = clean(row.pitchType);
    if (pitch) pitchCounts.set(pitch, (pitchCounts.get(pitch) || 0) + 1);
  }
  const topPitch = [...pitchCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  return {
    date: clean(day.date),
    rows,
    total: rows.length,
    hardest,
    longest,
    topPitch
  };
}

const recentResultDays = arr(resultsHistory.days)
  .map(resultDaySummary)
  .filter(Boolean)
  .slice(0, 8);

function add(slot, type, weight, text, players = [], meta = {}) {
  const body = text.trim();
  if (body.length < 60) return;
  candidates.push({
    id: meta.id || `${TODAY}_${slot.toUpperCase()}_${type.toUpperCase()}`,
    date: TODAY,
    createdAt: NOW,
    slot,
    type,
    weight,
    text: body,
    post: body,
    players: players.map(clean).filter(Boolean),
    fingerprint: fingerprint(body),
    eventPost: meta.eventPost === true || EVENT_POST_TYPES.has(type),
    ...meta
  });
}

if (!noPublishableSlate && best.length >= 3) {
  const lead = best[0];
  add("morning", "slate_read", 100,
`I finished the first pass through today's MLB slate. Three HR profiles separated from the pack:

1. ${playerLine(best[0])}
2. ${playerLine(best[1])}
3. ${playerLine(best[2])}

The important part: ${reasonSentence(lead)}

Who is your favorite HR look today?`, best.slice(0, 3).map(row => row.player));
}

if (!noPublishableSlate && confirmed.length) {
  const row = confirmed[0];
  add("midday", "lineup_spotlight", 96,
`The confirmed lineups gave me one profile worth revisiting: ${clean(row.player)}.

Batting ${row.lineupSpot} for ${clean(row.team)} against ${clean(row.opposingPitcher || row.pitcher || "the listed starter")}.

${reasonSentence(row)} Projected plate appearances: ${one(row.projectedPlateAppearances)}.

That is the kind of lineup context that can turn an interesting profile into a playable one.`, [row.player]);
}

if (!noPublishableSlate && pitchers.length) {
  const pitcher = pitchers[0];
  const bats = allPlayers.filter(row => norm(row.opposingPitcher || row.pitcher) === norm(pitcher.pitcher || pitcher.name)).slice(0, 2);
  const batText = bats.length
    ? `The two bats I would inspect first are ${bats.map(row => clean(row.player)).join(" and ")}.`
    : `This is a game environment I would inspect before narrowing the hitter board.`;
  add("afternoon", "pitcher_problem", 94,
`One pitching matchup stands out today: ${clean(pitcher.pitcher || pitcher.name)} vs ${clean(pitcher.opponent)}.

Vulnerability index: ${one(pitcher.vulnerability)}
ERA: ${one(pitcher.stats?.era)}
HR allowed: ${num(pitcher.stats?.homeRuns)} in ${one(pitcher.stats?.inningsPitched)} innings

${batText}

Is this the game you are targeting, or are you fading the obvious spot?`, bats.map(row => row.player));
}

if (!noPublishableSlate && value.length) {
  const row = value[0];
  add("afternoon", "value_thought", 86,
`A less obvious name on my board today: ${clean(row.player)}.

The model is not calling this a safe play. It is saying the matchup may be better than the market perception: ${reasonSentence(row)}

HR confidence ${one(row.hrConfidence)} | Pitch edge ${one(row.pitchEdge)} | Opponent ${clean(row.opposingPitcher || row.pitcher)}

Would you rather play the stronger name or the better price?`, [row.player]);
}

if (!noPublishableSlate && best.length) {
  const row = confirmed[0] || best[0];
  const finalMetrics = [
    `HR confidence ${one(row.hrConfidence)}`,
    `Power ${one(row.powerScore)}`,
    num(row.pitchEdge) > 0 && num(row.pitchEdge) <= 100 ? `Pitch edge ${one(row.pitchEdge)}` : "",
    `Bullpen context ${one(row.bullpen)}`
  ].filter(Boolean).join("\n");
  add("pregame", "final_read", 98,
`Final HR board check: if I had to narrow the entire slate to one profile, I keep coming back to ${clean(row.player)}.

${reasonSentence(row)}

${finalMetrics}

Full player breakdown: ${SITE_URL}/mlb.html

One lean—not a guarantee.`, [row.player]);
}

const weatherGames = weatherRows.map(row => {
  const game = gameRows.find(item => norm(item.venue) === norm(row.venue));
  const carry = num(row.carryScore ?? row.hrWeatherBoost ?? row.weatherScore);
  return { ...row, matchup: game?.matchup || "", carry };
}).filter(row => row.matchup && (num(row.windSpeed) >= 10 || num(row.temp) >= 82 || row.carry > 0))
  .sort((a, b) => b.carry - a.carry || num(b.windSpeed) - num(a.windSpeed));

if (!noPublishableSlate && weatherGames.length) {
  const row = weatherGames[0];
  add("midday", "weather_note", 78,
`Weather note—not a pick by itself:

${row.matchup} at ${clean(row.venue)} is the environment I am watching most closely.

${Math.round(num(row.temp))}° | ${one(row.windSpeed)} mph ${clean(row.windCompass)}

Weather can amplify a good power matchup. It cannot rescue a bad one. Which park conditions are you watching today?`, []);
}

if (homeRuns.length) {
  const documentedHits = homeRuns.map(qualifiedHomeRun).filter(Boolean)
    .sort((a, b) => {
      const sectionDiff = sectionPriority(a.primary.section) - sectionPriority(b.primary.section);
      if (sectionDiff) return sectionDiff;
      return num(a.primary.rank, 9999) - num(b.primary.rank, 9999);
    });

  for (const [index, hit] of documentedHits.entries()) {
    const { result: row, snapshot, primary, memberships, qualifiedBy } = hit;
    const player = clean(row.player || row.batter);
    const tagLine = memberships.length
      ? memberships.slice(0, 3).map(item => `${item.section} #${item.rank}`).join(" · ")
      : `${clean(snapshot?.grade)} archive rank #${num(snapshot?.rank)}`;
    const stats = [
      row.distance ? `${Math.round(num(row.distance))} ft` : "",
      row.exitVelocity ? `${one(row.exitVelocity)} mph EV` : "",
      row.launchAngle ? `${Math.round(num(row.launchAngle))}° LA` : ""
    ].filter(Boolean).join(" · ");
    const game = clean(row.game) || [clean(row.team), clean(row.opponent)].filter(Boolean).join(" vs ");
    const inning = clean(row.inning);
    const offPitcher = clean(row.pitcher) ? `Off ${clean(row.pitcher)}` : "";
    const headline = primary.section === "LIVE LONGSHOTS"
      ? "🚨 SLIP LAB LONGSHOT HIT"
      : ["TOP 5", "TOP 10"].includes(primary.section)
        ? `🚨 ${primary.section} HR HIT`
        : "🚨 SLIP LAB CALLED IT";

    add("live", "called_it_home_run", 130 - index,
`${headline}

${player} just left the yard.

AI Says: ${tagLine}
${game}
${inning}
${stats}
${offPitcher}

Board: ${SITE_URL}/ai-says.html`, [player], {
      id: eventIdForHomeRun(row, "called_it_home_run"),
      eventPost: true,
      event: {
        gamePk: row.gamePk ?? null,
        playId: row.playId ?? null,
        playerId: row.playerId ?? null,
        player,
        team: row.team || null,
        opponent: row.opponent || null,
        inning: row.inning || null,
        distance: row.distance ?? null,
        exitVelocity: row.exitVelocity ?? null,
        launchAngle: row.launchAngle ?? null
      },
      ai: {
        primarySection: primary.section,
        primaryRank: primary.rank,
        sections: memberships,
        archiveGrade: snapshot?.grade || null,
        archiveRank: snapshot?.rank || null,
        qualifiedBy
      }
    });
  }
}

const dailyReport = calibration?.dailyReport;
if (dailyReport?.status === "verified"
  && dailyReport.reportDate === previousResults?.date
  && dailyReport.verification?.latestSnapshotBeforeFirstPitch === true
  && dailyReport.verification?.resultSlateFinal === true
  && arr(dailyReport.verifiedCalls).length) {
  const featured = arr(dailyReport.verifiedCalls).slice(0, 3);
  const lines = featured.map(call => {
    const details = [
      call.rank ? `pregame rank #${call.rank}` : "verified pregame call",
      call.probability !== null ? `${one(call.probability)}% model probability` : "",
      call.distance ? `${Math.round(num(call.distance))} ft` : ""
    ].filter(Boolean).join(" | ");
    return `• ${clean(call.player)}: ${details}`;
  });
  const delta = num(dailyReport.actualVsExpected);

  add("overnight", "verified_daily_recap", 110,
`The verified MLB model report for ${clean(dailyReport.reportDate)} is in.

${dailyReport.actualSlateHomeRuns} home runs landed against ${one(dailyReport.expectedHomeRuns)} expected (${delta >= 0 ? "+" : ""}${one(delta)}).
Top 10: ${dailyReport.top10?.hits || 0} hits from ${dailyReport.top10?.predictions || 0} archived players.

${lines.join("\n")}

Every label comes from an archived snapshot captured before first pitch and was matched to final results. What should the model have weighted differently?`, featured.map(call => call.player), {
    graphic: `exports/content/graphics/${TODAY}_VERIFIED_MODEL_REPORT.png`,
    graphicType: "verified_model_report",
    reportDate: dailyReport.reportDate,
    resultsDate: previousResults.date,
    verifiedPregame: true,
    verifiedResults: true
  });
}

if (!noPublishableSlate) add("evening", "process_question", 55,
`Quick question for anyone building an MLB card: what signal do you trust most when the data disagrees—recent form, pitcher matchup, weather, or price?

I built The Slip Lab because I wanted all four in one place, but I still think the hardest part is deciding which signal deserves the most weight.`, []);

if (noPublishableSlate) {
  for (const [index, day] of recentResultDays.entries()) {
    const hardestName = clean(day.hardest.player || day.hardest.batter);
    const longestName = clean(day.longest.player || day.longest.batter);
    const commonMeta = {
      resultsDate: day.date,
      verifiedResults: true,
      limitedSlate: true
    };
    const slateLabel = noGamesScheduled ? "No MLB games are scheduled today" : "There is no full model-ready MLB slate today";

    add("morning", `off_day_receipt_${index + 1}`, 92 - index,
`${slateLabel}, so I used the morning to review the ${day.date} result feed instead.

${day.total} home run${day.total === 1 ? "" : "s"} recorded.
Longest: ${longestName} — ${Math.round(num(day.longest.distance))} ft
Hardest: ${hardestName} — ${one(day.hardest.exitVelocity)} mph

No forced picks on an empty board. Just verified results and a cleaner read for the next slate.`, [longestName, hardestName], commonMeta);

    add("midday", `swing_review_${index + 1}`, 91 - index,
`One swing from the ${day.date} results worth revisiting: ${hardestName}.

• ${one(day.hardest.exitVelocity)} mph exit velocity
• ${Math.round(num(day.hardest.distance))} feet
• ${clean(day.hardest.pitchType) || "Pitch type unavailable"} from ${clean(day.hardest.pitcher) || "the listed pitcher"}

With no current MLB slate to force, this is a good day to study what actually left the yard. What part of a home run profile do you trust most?`, [hardestName], commonMeta);

    if (day.topPitch) {
      add("afternoon", `pitch_result_review_${index + 1}`, 90 - index,
`A quick pitch-type note from the ${day.date} home run results:

${day.topPitch[1]} of the ${day.total} recorded homers came against ${day.topPitch[0]}s.

That is descriptive—not a claim that every ${day.topPitch[0]} is vulnerable. The useful question is where the pitch was located and whether the hitter's damage profile matched it.

That is the matchup layer I will be watching when the next full slate opens.`, [], commonMeta);
    }

    add("pregame", `off_day_long_ball_${index + 1}`, 93 - index,
`No regular pregame HR board tonight, but this result from ${day.date} deserves a second look:

${longestName} went ${Math.round(num(day.longest.distance))} feet at ${one(day.longest.exitVelocity)} mph off a ${clean(day.longest.pitchType) || "recorded pitch"}.

I would rather post one verified swing than manufacture a play when there is no model-ready slate.

Results board: ${SITE_URL}/results.html`, [longestName], commonMeta);

    add("evening", `off_day_question_${index + 1}`, 89 - index,
`The ${day.date} feed finished with ${day.total} home run${day.total === 1 ? "" : "s"}.

${hardestName} supplied the hardest contact at ${one(day.hardest.exitVelocity)} mph. ${longestName} supplied the longest ball at ${Math.round(num(day.longest.distance))} feet.

Which tells you more about a hitter going forward: peak exit velocity, distance, pitch-type matchup, or recent frequency?`, [hardestName, longestName], commonMeta);
  }
}

const selectedEventPosts = candidates
  .filter(candidate => candidate.eventPost === true || EVENT_POST_TYPES.has(candidate.type))
  .sort((a, b) => b.weight - a.weight)
  .map(candidate => ({
    ...candidate,
    contentSelection: "event_receipt",
    recentSimilarity: 0
  }));

const selected = [...selectedEventPosts];
for (const slot of ["morning", "midday", "afternoon", "pregame", "evening", "overnight"]) {
  const choices = candidates
    .filter(candidate => candidate.slot === slot && candidate.eventPost !== true && !EVENT_POST_TYPES.has(candidate.type))
    .sort((a, b) => b.weight - a.weight);
  const scored = choices.map(candidate => ({
    candidate,
    similarity: recentPosts.reduce((highest, post) => Math.max(highest, similarity(candidate.text, post.text || "")), 0)
  }));
  const fresh = scored.find(item => item.similarity < 0.64);
  const leastRepetitive = scored.slice().sort((a, b) => a.similarity - b.similarity || b.candidate.weight - a.candidate.weight)[0];
  const choice = fresh || leastRepetitive;

  if (choice) {
    selected.push({
      ...choice.candidate,
      contentSelection: fresh ? "fresh_language" : "least_repetitive_live_story",
      recentSimilarity: Number(choice.similarity.toFixed(3))
    });
  }
}

const output = {
  updatedAt: NOW,
  date: TODAY,
  version: "Content Engine 3.0",
  source: "live Slip Lab MLB production outputs",
  availability: noGamesScheduled
    ? "no_games_scheduled"
    : noPublishableSlate
      ? "no_publishable_slate"
      : "live_slate",
  fakeData: false,
  count: selected.length,
  rules: [
    "One strongest story per daypart",
    "Every metric comes from a current production JSON input",
    "Results are not described as predictions without pregame evidence",
    "Recent post history prefers fresh language and falls back to the least-repetitive current live story",
    "Website links appear selectively rather than in every post",
    "Qualified home-run receipts are event posts and are not reduced to one per daypart"
  ],
  posts: selected,
  live: selected.filter(post => post.slot === "live"),
  morning: selected.filter(post => post.slot === "morning"),
  midday: selected.filter(post => post.slot === "midday"),
  afternoon: selected.filter(post => post.slot === "afternoon"),
  pregame: selected.filter(post => post.slot === "pregame"),
  evening: selected.filter(post => post.slot === "evening"),
  overnight: selected.filter(post => post.slot === "overnight")
};

fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2));
fs.writeFileSync(OUT_TXT, selected.map(post => `${post.slot.toUpperCase()} | ${post.type}\n${post.text}`).join("\n\n---\n\n"));

console.log("CONTENT ENGINE 3.0 COMPLETE");
console.log("Date:", output.date);
console.log("Posts:", output.count);
console.log("Slots:", selected.map(post => post.slot).join(", "));
console.log("Saved:", OUT_JSON);
