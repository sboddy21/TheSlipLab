import fs from "fs";
import path from "path";
import { buildCurrentUsageProfiles, parseNflUsageGame, receivingBacktest } from "./current_usage.mjs";

const root = process.cwd();
const schedule = JSON.parse(fs.readFileSync(path.join(root, "website/data/nfl_schedule.json"), "utf8"));
const playerPoolPath = path.join(root, "website/data/nfl_player_pool.json");
const playerPoolPayload = fs.existsSync(playerPoolPath) ? JSON.parse(fs.readFileSync(playerPoolPath, "utf8")) : [];
const playerPool = Array.isArray(playerPoolPayload) ? playerPoolPayload : playerPoolPayload.players ?? [];
const cachePath = path.join(root, "data/nfl/current_usage_games.json");
const outputPath = path.join(root, "website/data/nfl_current_usage.json");
fs.mkdirSync(path.dirname(cachePath), { recursive: true });

const games = Array.isArray(schedule) ? schedule : schedule.games ?? [];
const completed = games.filter((game) => game.completed === true && Number(game.seasonType ?? game.season?.type ?? 2) === 2);
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : { games: [] };
const byId = new Map((cache.games ?? []).map((game) => [String(game.gameId), game]));
const missing = completed.filter((game) => {
  const cached = byId.get(String(game.gameId ?? game.id));
  return !cached || !cached.gameDate || (cached.players ?? []).some((player) => !player.opponent);
});

async function fetchGame(game) {
  const gameId = game.gameId ?? game.id;
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`);
  if (!response.ok) throw new Error(`NFL summary ${gameId} returned ${response.status}`);
  return parseNflUsageGame(await response.json(), game);
}

for (let index = 0; index < missing.length; index += 8) {
  const batch = missing.slice(index, index + 8);
  const records = await Promise.all(batch.map(fetchGame));
  for (const record of records) byId.set(record.gameId, record);
}

const gameRecords = completed.map((game) => byId.get(String(game.gameId ?? game.id))).filter(Boolean);
if (gameRecords.length !== completed.length) throw new Error(`NFL current usage incomplete: ${gameRecords.length}/${completed.length} completed games`);
const profiles = buildCurrentUsageProfiles(gameRecords, playerPool);
const validation = receivingBacktest(profiles);
const payload = {
  sport: "NFL",
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  source: "ESPN NFL box scores",
  completedGames: gameRecords.length,
  profileCount: profiles.length,
  validation,
  profiles,
};
fs.writeFileSync(cachePath, JSON.stringify({ generatedAt: payload.generatedAt, games: [...byId.values()] }, null, 2));
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(`NFL current usage: ${gameRecords.length} games, ${profiles.length} players, ${validation.samples} receiving backtest samples`);
