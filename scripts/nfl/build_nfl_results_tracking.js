import fs from "fs";
import path from "path";

const DATA = path.resolve("website/data"), generatedAt = new Date().toISOString();
const read = file => JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(DATA, file), `${JSON.stringify(value, null, 2)}\n`);
const number = value => Number(String(value ?? "0").replaceAll(",", "")) || 0;

async function fetchSummary(gameId, attempts = 3) {
  let error;
  for (let attempt = 1; attempt <= attempts; attempt++) try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`, { headers: { Accept: "application/json", "User-Agent": "TheSlipLab/1.0" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (caught) { error = caught; if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 500)); }
  throw error;
}

function extractPlayers(summary, gameId) {
  const players = new Map();
  for (const teamBox of summary.boxscore?.players || []) for (const category of teamBox.statistics || []) {
    if (!["passing", "rushing", "receiving"].includes(category.name)) continue;
    for (const item of category.athletes || []) {
      const id = String(item.athlete?.id || ""); if (!id) continue;
      if (!players.has(id)) players.set(id, { gameId, playerId: id, playerName: item.athlete?.displayName || "", team: teamBox.team?.abbreviation || "", passingYards: 0, rushingYards: 0, receivingYards: 0, rushingTds: 0, receivingTds: 0 });
      const row = players.get(id), stats = Object.fromEntries((category.labels || []).map((label, i) => [label, item.stats?.[i]]));
      if (category.name === "passing") row.passingYards = number(stats.YDS);
      if (category.name === "rushing") Object.assign(row, { rushingYards: number(stats.YDS), rushingTds: number(stats.TD) });
      if (category.name === "receiving") Object.assign(row, { receivingYards: number(stats.YDS), receivingTds: number(stats.TD) });
    }
  }
  return [...players.values()].map(row => ({ ...row, anytimeTouchdown: row.rushingTds + row.receivingTds > 0 }));
}

function lockSnapshots(existing, games, td, receiving) {
  const snapshots = Array.isArray(existing?.snapshots) ? existing.snapshots.filter(row => row.gameId) : [];
  for (const game of games.filter(row => !row.completed && Date.parse(row.kickoffUTC) > Date.now())) {
    const snapshotId = `week-${game.week}|game-${game.gameId}`; if (snapshots.some(row => row.snapshotId === snapshotId)) continue;
    snapshots.push({ snapshotId, snapshotAt: generatedAt, week: game.week, gameId: game.gameId, kickoffUTC: game.kickoffUTC, status: "locked_pre_kickoff_member_snapshot",
      anytimeTouchdown: td.rows.filter(row => row.gameId === game.gameId && row.launchEligible).map(row => ({ playerId: row.playerId, playerName: row.playerName, rank: row.shadowRank, score: row.tdSignalScore })),
      receivingYards: receiving.rows.filter(row => row.gameId === game.gameId && row.launchEligible).map(row => ({ playerId: row.playerId, playerName: row.playerName, rank: row.shadowRank, score: row.receivingSignalScore })) });
  }
  return snapshots;
}

async function main() {
  const schedule = read("nfl_schedule.json"), td = read("nfl_td_decision_center.json"), receiving = read("nfl_receiving_yards_board.json"), existing = read("nfl_results_tracking.json");
  const games = schedule.games.filter(game => game.seasonType === 2 && game.week === td.week), snapshots = lockSnapshots(existing, games, td, receiving);
  const gameResults = [], playerResults = [], failures = [];
  for (const game of games.filter(row => row.completed || Date.parse(row.kickoffUTC) <= Date.now())) try {
    const summary = await fetchSummary(game.gameId), status = summary.header?.competitions?.[0]?.status?.type || {};
    gameResults.push({ gameId: game.gameId, completed: Boolean(status.completed), state: status.state || "unknown", detail: status.detail || "" }); playerResults.push(...extractPlayers(summary, game.gameId));
  } catch (error) { failures.push({ gameId: game.gameId, error: error.message }); }
  const completed = new Set(gameResults.filter(row => row.completed).map(row => row.gameId)), byKey = new Map(playerResults.map(row => [`${row.gameId}|${row.playerId}`, row]));
  const tdGrades = snapshots.flatMap(s => completed.has(s.gameId) ? s.anytimeTouchdown.map(row => ({ ...row, gameId: s.gameId, hit: byKey.get(`${s.gameId}|${row.playerId}`)?.anytimeTouchdown === true })) : []);
  const receivingOutcomes = snapshots.flatMap(s => completed.has(s.gameId) ? s.receivingYards.map(row => ({ ...row, gameId: s.gameId, receivingYards: byKey.get(`${s.gameId}|${row.playerId}`)?.receivingYards ?? 0 })) : []);
  const liveGames = gameResults.filter(row => row.state === "in").length;
  const output = { sport: "NFL", schemaVersion: "1.0", generatedAt, week: td.week, status: liveGames ? "live_games_available" : completed.size ? "regular_season_results_available" : "waiting_for_kickoff",
    methodology: { snapshotRequiredBeforeKickoff: true, retroactiveSelectionsForbidden: true, gradingProvider: "ESPN live and completed-game box scores", receivingIsOutcomeNotLineGrade: true },
    counts: { completedGames: completed.size, liveGames, snapshots: snapshots.length, tdSelectionsGraded: tdGrades.length, receivingSelectionsGraded: receivingOutcomes.length, providerFailures: failures.length },
    snapshots, games: gameResults, playerResults, tdGrades, receivingOutcomes, failures };
  write("nfl_results_tracking.json", output); console.log(`NFL RESULTS TRACKING: ${liveGames} live, ${completed.size} final, ${snapshots.length} pre-kickoff locks`);
}
main().catch(error => { console.error("NFL RESULTS TRACKING FAILED"); console.error(error); process.exit(1); });
