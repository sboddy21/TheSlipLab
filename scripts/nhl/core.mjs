export const NHL_API = 'https://api-web.nhle.com/v1';
export const NHL_STATS = 'https://api.nhle.com/stats/rest/en';

export function easternDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function perGame(value, games) {
  return games > 0 ? Number(value || 0) / games : 0;
}

export function projectionFor(player) {
  const games = Number(player.gamesPlayed || 0);
  const shots = perGame(player.shots, games);
  const goals = perGame(player.goals, games);
  const assists = perGame(player.assists, games);
  const toi = Number(player.timeOnIcePerGame || 0) / 60;
  const roleFactor = clamp(0.88 + (toi - 15) * 0.012, 0.82, 1.12);
  const shotsProjection = clamp(shots * roleFactor, 0, 7.5);
  const goalExpectation = clamp(goals * roleFactor, 0, 1.05);
  const assistProjection = clamp(assists * roleFactor, 0, 1.35);
  const goalProbability = clamp(1 - Math.exp(-goalExpectation), 0.02, 0.65);
  const confidence = clamp(42 + Math.min(games, 82) * 0.55, 42, 87);
  return {
    shotsProjection: +shotsProjection.toFixed(2),
    goalProbability: +(goalProbability * 100).toFixed(1),
    assistsProjection: +assistProjection.toFixed(2),
    pointsProjection: +(goalExpectation + assistProjection).toFixed(2),
    season: { games, shotsPerGame: +shots.toFixed(2), goals: Number(player.goals || 0), assists: Number(player.assists || 0), points: Number(player.points || 0), toi: +toi.toFixed(1) },
    confidence: +confidence.toFixed(0)
  };
}

export function normalizeGame(game) {
  const team = side => ({
    id: game[`${side}Team`]?.id,
    name: `${game[`${side}Team`]?.placeName?.default || ''} ${game[`${side}Team`]?.commonName?.default || ''}`.trim(),
    abbreviation: game[`${side}Team`]?.abbrev,
    logo: game[`${side}Team`]?.logo,
    score: game[`${side}Team`]?.score ?? null,
    odds: game[`${side}Team`]?.odds?.[0]?.value || null
  });
  return {
    gameId: game.id, gameType: game.gameType, season: game.season,
    startTimeUTC: game.startTimeUTC, state: game.gameState,
    venue: game.venue?.default || '', neutralSite: Boolean(game.neutralSite),
    away: team('away'), home: team('home'),
    period: game.periodDescriptor?.number || 0,
    clock: game.clock?.timeRemaining || null,
    gameCenterLink: game.gameCenterLink || ''
  };
}

export function isLive(state) { return ['LIVE', 'CRIT'].includes(state); }
export function isFinal(state) { return ['FINAL', 'OFF'].includes(state); }
