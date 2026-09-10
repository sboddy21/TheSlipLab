const canonicalTeam = value => ({ LA: "LAR", JAC: "JAX", WAS: "WSH" })[value] || value;

export function selectWeekGames(schedule, week) {
  const games = (schedule?.games || []).filter(game => game.seasonType === 2 && game.week === week);
  const gameIds = new Set();
  const teams = new Set();

  for (const game of games) {
    const gameId = String(game.gameId || "");
    const home = canonicalTeam(game.homeTeam?.abbreviation);
    const away = canonicalTeam(game.awayTeam?.abbreviation);
    if (!gameId || !home || !away || home === away) throw new Error(`Week ${week} contains an invalid game assignment`);
    if (gameIds.has(gameId)) throw new Error(`Week ${week} contains duplicate game ${gameId}`);
    if (teams.has(home) || teams.has(away)) throw new Error(`Week ${week} assigns a team to multiple games`);
    gameIds.add(gameId);
    teams.add(home);
    teams.add(away);
  }

  if (!games.length) throw new Error(`Week ${week} has no regular-season games`);
  return games;
}

