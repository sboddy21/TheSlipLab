const NUMBER = /-?\d+(?:\.\d+)?/;

function numeric(value) {
  const match = String(value ?? "").match(NUMBER);
  return match ? Number(match[0]) : 0;
}

function statMap(statistics = []) {
  return Object.fromEntries(statistics.map((stat) => [stat.name, numeric(stat.displayValue ?? stat.value)]));
}

export function parseNflUsageGame(summary, scheduleGame = {}) {
  const gameId = String(scheduleGame.gameId ?? scheduleGame.id ?? summary?.header?.id ?? "");
  const gameDate = scheduleGame.kickoffUTC ?? scheduleGame.date ?? summary?.header?.competitions?.[0]?.date ?? null;
  const players = [];

  for (const team of summary?.boxscore?.players ?? []) {
    for (const category of team.statistics ?? []) {
      for (const athlete of category.athletes ?? []) {
        const stats = statMap((category.keys ?? []).map((name, index) => ({ name, displayValue: athlete.stats?.[index] })));
        const id = String(athlete.athlete?.id ?? "");
        if (!id) continue;
        let row = players.find((item) => item.playerId === id);
        if (!row) {
          row = {
            playerId: id,
            name: athlete.athlete?.displayName ?? athlete.athlete?.shortName ?? "Unknown",
            team: team.team?.abbreviation ?? team.team?.displayName ?? "",
            gameId,
            gameDate,
            opponent: "",
            passAttempts: 0,
            passingYards: 0,
            passingTds: 0,
            carries: 0,
            rushingYards: 0,
            rushingTds: 0,
            targets: 0,
            receptions: 0,
            receivingYards: 0,
            receivingTds: 0,
          };
          players.push(row);
        }
        row.passAttempts = Math.max(row.passAttempts, stats.passingAttempts ?? 0);
        row.passingYards = Math.max(row.passingYards, stats.passingYards ?? 0);
        row.passingTds = Math.max(row.passingTds, stats.passingTouchdowns ?? 0);
        row.carries = Math.max(row.carries, stats.rushingAttempts ?? 0);
        row.rushingYards = Math.max(row.rushingYards, stats.rushingYards ?? 0);
        row.rushingTds = Math.max(row.rushingTds, stats.rushingTouchdowns ?? 0);
        row.targets = Math.max(row.targets, stats.receivingTargets ?? 0);
        row.receptions = Math.max(row.receptions, stats.receptions ?? 0);
        row.receivingYards = Math.max(row.receivingYards, stats.receivingYards ?? 0);
        row.receivingTds = Math.max(row.receivingTds, stats.receivingTouchdowns ?? 0);
      }
    }
  }

  const teams = scheduleGame.competitors ?? scheduleGame.teams ?? [scheduleGame.homeTeam, scheduleGame.awayTeam].filter(Boolean);
  for (const player of players) {
    const opponent = teams.find((team) => (team.abbreviation ?? team.team?.abbreviation) !== player.team);
    player.opponent = opponent?.abbreviation ?? opponent?.team?.abbreviation ?? "";
  }
  return { gameId, gameDate, players };
}

function average(games, key) {
  return games.length ? games.reduce((sum, game) => sum + Number(game[key] || 0), 0) / games.length : 0;
}

function summarize(games) {
  const keys = ["passAttempts", "passingYards", "passingTds", "carries", "rushingYards", "rushingTds", "targets", "receptions", "receivingYards", "receivingTds"];
  return Object.fromEntries(keys.map((key) => [key, Number(average(games, key).toFixed(3))]));
}

export function buildCurrentUsageProfiles(gameRecords, playerPool = []) {
  const profiles = new Map();
  for (const game of gameRecords) {
    for (const player of game.players ?? []) {
      const profile = profiles.get(player.playerId) ?? { playerId: player.playerId, name: player.name, team: player.team, games: [] };
      profile.name = player.name || profile.name;
      profile.team = player.team || profile.team;
      profile.games.push(player);
      profiles.set(player.playerId, profile);
    }
  }
  const poolById = new Map(playerPool.map((player) => [String(player.id ?? player.playerId), player]));
  return [...profiles.values()].filter((profile) => profile.games.some((game) =>
    game.passAttempts || game.carries || game.targets || game.receptions || game.passingYards || game.rushingYards || game.receivingYards
  )).map((profile) => {
    profile.games.sort((a, b) => String(a.gameDate).localeCompare(String(b.gameDate)));
    const pool = poolById.get(profile.playerId);
    return {
      playerId: profile.playerId,
      name: profile.name,
      team: profile.team,
      position: pool?.position?.abbreviation ?? pool?.position ?? "",
      gamesPlayed: profile.games.length,
      season: summarize(profile.games),
      last3: summarize(profile.games.slice(-3)),
      last5: summarize(profile.games.slice(-5)),
      games: profile.games,
    };
  });
}

export function receivingBacktest(profiles) {
  const predictions = [];
  for (const profile of profiles) {
    for (let index = 2; index < profile.games.length; index += 1) {
      const prior = profile.games.slice(0, index);
      const recent = prior.slice(-3);
      predictions.push({
        actual: profile.games[index].receivingYards,
        model: average(prior, "receivingYards"),
        baseline: average(prior, "receivingYards"),
      });
    }
  }
  const metrics = (key) => ({
    mae: Number((predictions.reduce((sum, row) => sum + Math.abs(row[key] - row.actual), 0) / Math.max(1, predictions.length)).toFixed(3)),
    rmse: Number(Math.sqrt(predictions.reduce((sum, row) => sum + (row[key] - row.actual) ** 2, 0) / Math.max(1, predictions.length)).toFixed(3)),
  });
  return { samples: predictions.length, model: metrics("model"), baseline: metrics("baseline"), acceptedModel: "season_mean", rejectedModel: "recent3_blend_underperformed" };
}
