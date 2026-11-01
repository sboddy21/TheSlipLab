import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { backtestFirstBasketModel, buildFirstBasketProfiles, parseFirstBasketGame, scoreFirstBasketGame } from "./first_basket_model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = path.join(ROOT, "website/data");
const CACHE_FILE = path.join(ROOT, "data/nba/first_basket_history.json");
const OUT = path.join(DATA_DIR, "nba_first_basket.json");
const TEAMS = ["atl","bos","bkn","cha","chi","cle","dal","den","det","gs","hou","ind","lac","lal","mem","mia","mil","min","no","ny","okc","orl","phi","phx","por","sac","sa","tor","utah","wsh"];
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const seasonYear = () => new Date().getUTCMonth() >= 8 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear();

async function fetchJson(url, timeout = 12000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }); if (!response.ok) throw new Error(`${response.status} ${url}`); return response.json(); }
  finally { clearTimeout(timer); }
}
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; results[index] = await mapper(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)); return results;
}
async function scheduleIds(year) {
  const schedules = await mapLimit(TEAMS, 10, team => fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team}/schedule?season=${year}`).catch(() => null));
  return [...new Set(schedules.flatMap(data => data?.events || []).filter(event => event?.seasonType?.type === 2 && event?.competitions?.[0]?.status?.type?.completed).map(event => String(event.id || "")).filter(Boolean))];
}
function selectCandidates(pool, profiles) {
  const grouped = new Map();
  for (const player of pool.players || []) {
    if (String(player.status).toUpperCase() === "OUT") continue;
    const teamId = String(player.teamId || ""); if (!grouped.has(teamId)) grouped.set(teamId, []);
    grouped.get(teamId).push({ ...player, historicalStarts: profiles.players.get(String(player.playerId))?.starterGames || 0, lineupStatus: player.starter && player.starterKnown ? "CONFIRMED" : "PROJECTED" });
  }
  return [...grouped.values()].flatMap(rows => {
    const confirmed = rows.filter(row => row.lineupStatus === "CONFIRMED");
    return confirmed.length === 5 ? confirmed : rows.sort((a, b) => b.historicalStarts - a.historicalStarts).slice(0, 5).map(row => ({ ...row, lineupStatus: "PROJECTED" }));
  });
}
async function main() {
  const slate = read(path.join(DATA_DIR, "nba_games_today.json"), { games: [], date: "" });
  const pool = read(path.join(DATA_DIR, "nba_player_pool.json"), { players: [] });
  const cache = read(CACHE_FILE, { games: [] }); const known = new Set(cache.games.map(game => game.gameId));
  const years = process.env.NBA_FIRST_BASKET_BOOTSTRAP === "1" ? [seasonYear() - 1, seasonYear()] : [seasonYear()];
  const ids = (await Promise.all(years.map(scheduleIds))).flat().filter(id => !known.has(id));
  const additions = (await mapLimit(ids, 12, async id => { try { return parseFirstBasketGame(await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`)); } catch { return null; } })).filter(Boolean);
  const historyGames = [...cache.games, ...additions].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-1600);
  const profiles = buildFirstBasketProfiles(historyGames); const candidates = selectCandidates(pool, profiles);
  const validation = backtestFirstBasketModel(historyGames);
  const games = (slate.games || []).map(game => {
    const players = scoreFirstBasketGame({ game, candidates, profiles }) || [];
    const confirmed = players.length === 10 && players.every(player => player.lineupStatus === "CONFIRMED");
    return { gameId: game.gameId, matchup: `${game.awayTeam?.abbreviation || ""} @ ${game.homeTeam?.abbreviation || ""}`, gameTimeUTC: game.gameTimeUTC, lineupStatus: confirmed ? "CONFIRMED" : "PROJECTED", publicationStatus: confirmed && players.some(player => player.publicationEligible) ? "PUBLISHED" : "WAITING_FOR_CONFIRMED_LINEUPS", players };
  });
  const generatedAt = new Date().toISOString();
  const output = { sport: "NBA", market: "First Made Field Goal", version: "1.0", date: slate.date, generatedAt, source: "ESPN verified play-by-play and box-score starters", methodology: "Competing probability across ten starters using first-basket history, first-team-shot share, shooting efficiency, opening possession, tip history, and confirmed-lineup gating.", trainingGames: historyGames.length, addedTrainingGames: additions.length, validation, gameCount: games.length, publicationEligibleGames: validation.beatsUniformBaseline ? games.filter(game => game.publicationStatus === "PUBLISHED").length : 0, games: validation.beatsUniformBaseline ? games : games.map(game => ({ ...game, publicationStatus: "VALIDATION_GATE_CLOSED", players: game.players.map(player => ({ ...player, publicationEligible: false })) })) };
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify({ source: output.source, updatedAt: generatedAt, games: historyGames }, null, 2)); fs.writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`NBA FIRST BASKET: ${historyGames.length} training games, ${games.length} slate games, ${output.publicationEligibleGames} published`);
}
main().catch(error => { console.error(error); process.exit(1); });
