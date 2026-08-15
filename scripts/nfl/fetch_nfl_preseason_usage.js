import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../website/data");
const SEASON = Number(process.env.NFL_SEASON || 2026);
const OUT = path.join(DATA, "nfl_preseason_usage.json");
const SCHEDULE_URL = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${SEASON}&seasontype=1&limit=100`;
const summaryUrl = gameId => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "TheSlipLab/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`${lastError?.message || "request failed"}: ${url}`);
}

const number = value => {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

function statMap(category, row) {
  return Object.fromEntries((category.labels || []).map((label, index) => [label, row.stats?.[index] ?? ""]));
}

function playerRow(map, athlete, team, game) {
  const playerId = String(athlete.id || "");
  const key = `${game.gameId}|${playerId}`;
  if (!map.has(key)) map.set(key, {
    gameId: game.gameId, week: game.week, completedAt: game.completedAt,
    playerId, playerName: athlete.displayName || "", team,
    passAttempts: 0, completions: 0, passingYards: 0, passingTds: 0, interceptions: 0,
    carries: 0, rushingYards: 0, rushingTds: 0,
    targets: 0, receptions: 0, receivingYards: 0, receivingTds: 0
  });
  return map.get(key);
}

function extractGameUsage(summary, game) {
  if (!summary.header?.competitions?.[0]?.status?.type?.completed) {
    throw new Error(`Game ${game.gameId} summary is not final`);
  }
  const rows = new Map();
  for (const teamBox of summary.boxscore?.players || []) {
    const team = teamBox.team?.abbreviation || "";
    for (const category of teamBox.statistics || []) {
      if (!["passing", "rushing", "receiving"].includes(category.name)) continue;
      for (const item of category.athletes || []) {
        const row = playerRow(rows, item.athlete || {}, team, game);
        const stats = statMap(category, item);
        if (category.name === "passing") {
          const [completions, attempts] = String(stats["C/ATT"] || "0/0").split("/").map(number);
          Object.assign(row, { completions, passAttempts: attempts, passingYards: number(stats.YDS), passingTds: number(stats.TD), interceptions: number(stats.INT) });
        } else if (category.name === "rushing") {
          Object.assign(row, { carries: number(stats.CAR), rushingYards: number(stats.YDS), rushingTds: number(stats.TD) });
        } else {
          Object.assign(row, { receptions: number(stats.REC), receivingYards: number(stats.YDS), receivingTds: number(stats.TD), targets: number(stats.TGTS) });
        }
      }
    }
  }
  return [...rows.values()].filter(row => row.playerId && (row.passAttempts || row.carries || row.targets || row.receptions));
}

function summarizePlayers(gameRows, pool) {
  const poolById = new Map((pool.players || []).map(player => [String(player.playerId), player]));
  const byPlayer = new Map();
  for (const row of gameRows) {
    if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, []);
    byPlayer.get(row.playerId).push(row);
  }
  return [...byPlayer.entries()].map(([playerId, games]) => {
    const current = poolById.get(playerId);
    const sorted = games.sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
    const totals = metric => sorted.reduce((sum, game) => sum + number(game[metric]), 0);
    const opportunities = game => game.passAttempts + game.carries + game.targets;
    const latest = sorted.at(-1);
    const previous = sorted.at(-2) || null;
    const latestOpportunities = opportunities(latest);
    const previousOpportunities = previous ? opportunities(previous) : null;
    const teamsAtGame = [...new Set(sorted.map(game => game.team).filter(Boolean))];
    const currentTeam = current?.team || latest.team;
    const ownershipStatus = teamsAtGame.every(team => team === currentTeam) ? "current_team_match" : "team_changed_or_stale_game_team";
    return {
      playerId, playerName: current?.fullName || latest.playerName, team: currentTeam, teamsAtGame, ownershipStatus,
      position: current?.position || "", gameCount: sorted.length,
      totals: {
        passAttempts: totals("passAttempts"), carries: totals("carries"), targets: totals("targets"),
        completions: totals("completions"), passingYards: totals("passingYards"), rushingYards: totals("rushingYards"),
        receptions: totals("receptions"), receivingYards: totals("receivingYards"), totalTds: totals("passingTds") + totals("rushingTds") + totals("receivingTds")
      },
      latestGame: { gameId: latest.gameId, week: latest.week, opportunities: latestOpportunities },
      previousGame: previous ? { gameId: previous.gameId, week: previous.week, opportunities: previousOpportunities } : null,
      roleSignal: previousOpportunities === null ? "initial_sample" : latestOpportunities >= previousOpportunities + 3 ? "rising" : latestOpportunities <= previousOpportunities - 3 ? "falling" : "stable",
      signalEligibility: ownershipStatus !== "current_team_match" ? "withheld_team_change" : previousOpportunities === null ? "withheld_single_sample" : "eligible_for_role_review",
      startingUnitStatus: "unknown_not_in_box_score_source",
      games: sorted
    };
  }).sort((a, b) => b.latestGame.opportunities - a.latestGame.opportunities || a.playerName.localeCompare(b.playerName));
}

async function main() {
  const pool = JSON.parse(fs.readFileSync(path.join(DATA, "nfl_player_pool.json"), "utf8"));
  const schedule = await fetchJson(SCHEDULE_URL);
  const completedGames = (schedule.events || []).filter(event => event.season?.type === 1 && event.status?.type?.completed).map(event => ({
    gameId: String(event.id), week: Number(event.week?.number || 0), kickoffUTC: event.date,
    matchup: event.shortName || event.name || "", completedAt: event.status?.type?.detail || event.date
  }));
  const gameRows = [];
  const failures = [];
  for (const game of completedGames) {
    try { gameRows.push(...extractGameUsage(await fetchJson(summaryUrl(game.gameId)), game)); }
    catch (error) { failures.push({ gameId: game.gameId, error: error.message }); }
  }
  if (completedGames.length && failures.length) throw new Error(`Missing final usage for ${failures.length} completed game(s): ${failures.slice(0, 3).map(row => row.gameId).join(", ")}`);
  const players = summarizePlayers(gameRows, pool);
  const output = {
    sport: "NFL", schemaVersion: "1.0", season: SEASON, seasonType: "preseason", generatedAt: new Date().toISOString(),
    status: completedGames.length ? "final_games_processed" : "waiting_for_final_games",
    source: "ESPN NFL completed-game box scores", sourceUrl: SCHEDULE_URL,
    finalGameGate: true, completedGameCount: completedGames.length, processedGameCount: completedGames.length - failures.length,
    playerGameCount: gameRows.length, playerCount: players.length,
    teamsWithFinalGames: [...new Set(completedGames.flatMap(game => game.matchup.split(/\s+(?:@|VS)\s+/)).filter(Boolean))].sort(),
    completedGames, failures,
    coverage: {
      verified: ["passing attempts", "carries", "targets", "box-score production"],
      unavailable: ["offensive snap counts", "first-team snaps", "routes run"],
      note: "No participation conclusion is created until the game status is final. Unavailable fields are not inferred."
    },
    players
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`NFL PRESEASON USAGE COMPLETE: ${output.processedGameCount} final games, ${output.playerCount} players`);
}

main().catch(error => {
  console.error("NFL PRESEASON USAGE FAILED");
  console.error(error);
  process.exit(1);
});
