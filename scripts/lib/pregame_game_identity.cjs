function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function exactGameFromModelSources(games, ...sources) {
  for (const source of sources) {
    const gamePk = num(source?.gamePk);
    if (!gamePk) continue;
    const match = games.find(game => num(game?.gamePk) === gamePk);
    if (match) return match;
  }
  return null;
}

module.exports = { exactGameFromModelSources };
