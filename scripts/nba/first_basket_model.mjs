const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value, places = 4) => Number((Number(value) || 0).toFixed(places));
const participantId = play => String(play?.participants?.[0]?.athlete?.id || "");

function startersFromSummary(summary) {
  const starters = [];
  for (const teamBlock of summary?.boxscore?.players || []) {
    const teamId = String(teamBlock?.team?.id || "");
    const stats = teamBlock?.statistics?.[0] || {};
    const fieldGoalIndex = (stats.keys || []).indexOf("fieldGoalsMade-fieldGoalsAttempted");
    for (const entry of stats.athletes || []) {
      if (!entry?.starter || entry?.didNotPlay) continue;
      const fieldGoals = String(entry.stats?.[fieldGoalIndex] || "0-0").split("-").map(Number);
      starters.push({
        playerId: String(entry.athlete?.id || ""), player: entry.athlete?.displayName || "",
        position: entry.athlete?.position?.abbreviation || "", teamId,
        fieldGoalsMade: Number(fieldGoals[0]) || 0, fieldGoalsAttempted: Number(fieldGoals[1]) || 0
      });
    }
  }
  return starters;
}

export function parseFirstBasketGame(summary) {
  const competition = summary?.header?.competitions?.[0] || {};
  const starters = startersFromSummary(summary);
  const starterIds = new Set(starters.map(row => row.playerId));
  const plays = (summary?.plays || []).filter(play => Number(play?.period?.number) === 1);
  const jump = plays.find(play => /jumpball/i.test(String(play?.type?.text || "")));
  const shots = plays.filter(play => play?.shootingPlay && participantId(play));
  const firstMade = shots.find(play => play?.scoringPlay && Number(play?.scoreValue) >= 2);
  if (!competition.id || starters.length !== 10 || !firstMade || !starterIds.has(participantId(firstMade))) return null;
  const firstShotByTeam = {};
  for (const shot of shots) {
    const teamId = String(shot?.team?.id || "");
    if (teamId && !firstShotByTeam[teamId]) firstShotByTeam[teamId] = participantId(shot);
  }
  return {
    gameId: String(competition.id), date: competition.date || "",
    teams: (competition.competitors || []).map(entry => ({ teamId: String(entry.id || entry.team?.id || ""), abbreviation: entry.team?.abbreviation || "", homeAway: entry.homeAway || "" })),
    openingPossessionTeamId: String(jump?.team?.id || ""),
    tipParticipants: (jump?.participants || []).slice(0, 2).map(item => String(item?.athlete?.id || "")).filter(Boolean),
    firstBasketPlayerId: participantId(firstMade), firstBasketTeamId: String(firstMade?.team?.id || ""),
    firstBasketValue: Number(firstMade?.scoreValue) || 2, firstBasketClock: firstMade?.clock?.displayValue || "",
    firstShotByTeam, starters
  };
}

const emptyPlayer = player => ({ playerId: String(player?.playerId || ""), player: player?.player || "", position: player?.position || "", starterGames: 0, firstBaskets: 0, firstTeamShots: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, tipAppearances: 0, openingPossessionsWon: 0 });

export function buildFirstBasketProfiles(games = []) {
  const players = new Map(); const teams = new Map();
  for (const game of games) {
    for (const team of game.teams || []) {
      const profile = teams.get(team.teamId) || { teamId: team.teamId, games: 0, openingPossessions: 0, firstBaskets: 0 };
      profile.games += 1;
      if (game.openingPossessionTeamId === team.teamId) profile.openingPossessions += 1;
      if (game.firstBasketTeamId === team.teamId) profile.firstBaskets += 1;
      teams.set(team.teamId, profile);
    }
    for (const starter of game.starters || []) {
      const profile = players.get(starter.playerId) || emptyPlayer(starter);
      profile.player = starter.player || profile.player; profile.position = starter.position || profile.position;
      profile.starterGames += 1; profile.fieldGoalsMade += starter.fieldGoalsMade || 0; profile.fieldGoalsAttempted += starter.fieldGoalsAttempted || 0;
      if (game.firstBasketPlayerId === starter.playerId) profile.firstBaskets += 1;
      if (game.firstShotByTeam?.[starter.teamId] === starter.playerId) profile.firstTeamShots += 1;
      if ((game.tipParticipants || []).includes(starter.playerId)) { profile.tipAppearances += 1; if (game.openingPossessionTeamId === starter.teamId) profile.openingPossessionsWon += 1; }
      players.set(starter.playerId, profile);
    }
  }
  return { players, teams };
}

const betaMean = (successes, trials, priorMean, strength) => (successes + priorMean * strength) / Math.max(1, trials + strength);
function interval(probability, trials) {
  const n = Math.max(1, trials); const z = 1.2816; const denominator = 1 + z * z / n;
  const center = (probability + z * z / (2 * n)) / denominator;
  const spread = z * Math.sqrt((probability * (1 - probability) + z * z / (4 * n)) / n) / denominator;
  return [clamp(center - spread, 0, 1), clamp(center + spread, 0, 1)];
}

export function scoreFirstBasketGame({ game, candidates, profiles }) {
  const teamIds = [String(game.homeTeam?.teamId || ""), String(game.awayTeam?.teamId || "")];
  const eligible = candidates.filter(player => teamIds.includes(String(player.teamId)) && player.lineupStatus !== "OUT");
  if (teamIds.some(teamId => eligible.filter(player => String(player.teamId) === teamId).length !== 5)) return null;
  const teamOpening = new Map(teamIds.map(teamId => { const p = profiles.teams.get(teamId) || {}; return [teamId, betaMean(p.openingPossessions || 0, p.games || 0, 0.5, 12)]; }));
  const openingTotal = [...teamOpening.values()].reduce((sum, value) => sum + value, 0) || 1;
  const rawRows = eligible.map(player => {
    const profile = profiles.players.get(String(player.playerId)) || emptyPlayer(player);
    const team = profiles.teams.get(String(player.teamId)) || {};
    const factors = {
      firstBasketRate: betaMean(profile.firstBaskets, profile.starterGames, 0.1, 14),
      firstShotShare: betaMean(profile.firstTeamShots, profile.starterGames, 0.2, 12),
      fieldGoalRate: betaMean(profile.fieldGoalsMade, profile.fieldGoalsAttempted, 0.47, 30),
      teamFirstBasketRate: betaMean(team.firstBaskets || 0, team.games || 0, 0.5, 16),
      openingPossessionRate: (teamOpening.get(String(player.teamId)) || 0.5) / openingTotal,
      tipRate: profile.tipAppearances ? betaMean(profile.openingPossessionsWon, profile.tipAppearances, 0.5, 8) : 0.5
    };
    const raw = Math.max(0.0001, Math.pow(factors.firstBasketRate, .42) * Math.pow(factors.firstShotShare, .28) * Math.pow(factors.fieldGoalRate, .16) * Math.pow(factors.teamFirstBasketRate, .08) * Math.pow(factors.openingPossessionRate, .06) * (/C/.test(player.position || "") ? .9 + factors.tipRate * .2 : 1) * (player.lineupStatus === "CONFIRMED" ? 1 : .82));
    return { player, profile, factors, raw };
  });
  const total = rawRows.reduce((sum, row) => sum + row.raw, 0) || 1;
  return rawRows.map(row => {
    const probability = row.raw / total; const [low, high] = interval(probability, row.profile.starterGames + 10);
    const confirmed = row.player.lineupStatus === "CONFIRMED"; const evidence = row.profile.starterGames;
    return {
      playerId: String(row.player.playerId), player: row.player.player, team: row.player.teamAbbr || row.player.team, opponent: row.player.opponentAbbr || row.player.opponent, position: row.player.position || "", lineupStatus: row.player.lineupStatus,
      probability: round(probability), probabilityPct: round(probability * 100, 1), rangeLowPct: round(low * 100, 1), rangeHighPct: round(high * 100, 1),
      fairAmericanOdds: probability >= .5 ? Math.round(-100 * probability / (1 - probability)) : Math.round(100 * (1 - probability) / probability),
      confidence: confirmed && evidence >= 30 ? "STRONG EVIDENCE" : confirmed && evidence >= 12 ? "PLAYABLE EVIDENCE" : "LIMITED EVIDENCE",
      publicationEligible: confirmed && evidence >= 12,
      evidence: { starterGames: evidence, firstBaskets: row.profile.firstBaskets, firstTeamShots: row.profile.firstTeamShots, fieldGoalsMade: row.profile.fieldGoalsMade, fieldGoalsAttempted: row.profile.fieldGoalsAttempted },
      factors: Object.fromEntries(Object.entries(row.factors).map(([key, value]) => [key, round(value)]))
    };
  }).sort((a, b) => b.probability - a.probability);
}

export function backtestFirstBasketModel(games = [], holdoutSize = 200) {
  const split = Math.max(100, games.length - holdoutSize);
  const training = games.slice(0, split); const holdout = games.slice(split);
  const profiles = buildFirstBasketProfiles(training);
  let topOneHits = 0; let logLoss = 0; let brier = 0; let evaluated = 0;
  for (const historic of holdout) {
    const home = historic.teams.find(team => team.homeAway === "home") || historic.teams[0];
    const away = historic.teams.find(team => team.homeAway === "away") || historic.teams[1];
    if (!home || !away) continue;
    const candidates = historic.starters.map(player => ({ ...player, team: player.teamId, teamAbbr: player.teamId, opponent: player.teamId === home.teamId ? away.teamId : home.teamId, lineupStatus: "CONFIRMED" }));
    const rows = scoreFirstBasketGame({ game: { homeTeam: { teamId: home.teamId }, awayTeam: { teamId: away.teamId } }, candidates, profiles });
    const actual = rows?.find(row => row.playerId === historic.firstBasketPlayerId);
    if (!actual || rows.length !== 10) continue;
    evaluated += 1; if (rows[0].playerId === historic.firstBasketPlayerId) topOneHits += 1;
    logLoss += -Math.log(Math.max(0.0001, actual.probability));
    brier += rows.reduce((sum, row) => sum + Math.pow(row.probability - Number(row.playerId === historic.firstBasketPlayerId), 2), 0);
  }
  const uniformLogLoss = Math.log(10); const uniformBrier = 0.9;
  const averageLogLoss = evaluated ? logLoss / evaluated : null; const averageBrier = evaluated ? brier / evaluated : null;
  return {
    trainingGames: training.length, holdoutGames: evaluated,
    topOneAccuracyPct: evaluated ? round(topOneHits / evaluated * 100, 1) : null,
    logLoss: averageLogLoss === null ? null : round(averageLogLoss), uniformLogLoss: round(uniformLogLoss),
    brierScore: averageBrier === null ? null : round(averageBrier), uniformBrierScore: uniformBrier,
    beatsUniformBaseline: averageLogLoss !== null && averageLogLoss < uniformLogLoss && averageBrier < uniformBrier
  };
}
