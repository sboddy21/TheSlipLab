import fs from "fs";
import path from "path";

const DATA = path.resolve("website/data");
const read = file => JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(DATA, file), `${JSON.stringify(value, null, 2)}\n`);
const generatedAt = new Date().toISOString();
const now = Date.now();
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const maxQuoteAgeMinutes = Number(process.env.NFL_ODDS_MAX_QUOTE_AGE_MINUTES || 15);
const forecastMaxAgeHours = Number(process.env.NFL_WEATHER_MAX_AGE_HOURS || 6);

const VENUES = {
  "Lumen Field": [47.5952, -122.3316], "Melbourne Cricket Ground": [-37.8199, 144.9834], "Paycor Stadium": [39.0955, -84.5161],
  "Ford Field": [42.3400, -83.0456], "Nissan Stadium": [36.1665, -86.7713], "Lucas Oil Stadium": [39.7601, -86.1639],
  "Acrisure Stadium": [40.4468, -80.0158], "Bank of America Stadium": [35.2258, -80.8528], "EverBank Stadium": [30.3239, -81.6373],
  "Reliant Stadium": [29.6847, -95.4107], "Allegiant Stadium": [36.0908, -115.1830], "U.S. Bank Stadium": [44.9736, -93.2575],
  "Lincoln Financial Field": [39.9008, -75.1675], "SoFi Stadium": [33.9535, -118.3392], "MetLife Stadium": [40.8135, -74.0745],
  "Arrowhead Stadium": [39.0489, -94.4839]
};

function nextWeek(schedule) {
  return [...new Set(schedule.games.map(game => game.week))].sort((a, b) => a - b)
    .find(week => schedule.games.some(game => game.week === week && !game.completed && Date.parse(game.kickoffUTC) >= now));
}

function practiceContract(pool, injuries, roles, week) {
  const officialReportsActive = injuries.injuries.some(row => row.sourceCoverage === "official_weekly_practice_report");
  const injuryByPlayer = new Map(injuries.injuries.map(row => [row.playerId, row]));
  const roleByPlayer = new Map(roles.roles.map(row => [row.playerId, row]));
  const players = pool.players.map(player => {
    const injury = injuryByPlayer.get(player.playerId) || null;
    const status = normalize(injury?.status);
    const unavailable = /injured reserve|\bout\b|suspend|physically unable/.test(status);
    const limited = /questionable|doubtful|limited/.test(status);
    const role = roleByPlayer.get(player.playerId);
    const roleEligible = role?.modelEligibility === true && role?.depth?.rank === 1 && role?.preseasonParticipationStatus !== "team_without_final_game";
    return {
      playerId: player.playerId, playerName: player.fullName, team: player.team, position: player.position,
      reportStatus: injury?.status || "no_official_report",
      practiceParticipation: officialReportsActive ? (injury?.practiceParticipation || "not_listed") : "unavailable_pre_weekly_reports",
      gameStatus: unavailable ? "out" : limited ? "uncertain" : officialReportsActive ? "not_listed" : "unconfirmed",
      activeRosterGate: !unavailable,
      roleEligible,
      regularSeasonRoleConfirmed: officialReportsActive && !unavailable && roleEligible,
      source: injury?.sourceCoverage || "no_official_weekly_report"
    };
  });
  return {
    sport: "NFL", schemaVersion: "1.0", generatedAt, week,
    status: officialReportsActive ? "official_weekly_reports_available" : "waiting_for_official_weekly_reports",
    provider: "ESPN / official team designations", officialReportsActive,
    freshnessPolicy: { maximumAgeHours: 12, staleReportsAccepted: false, absenceMeansHealthy: false },
    counts: { players: players.length, roleConfirmed: players.filter(row => row.regularSeasonRoleConfirmed).length, unavailable: players.filter(row => !row.activeRosterGate).length },
    players
  };
}

async function weatherContract(games, week) {
  const rows = [];
  for (const game of games) {
    if (game.indoor) {
      rows.push({ gameId: game.gameId, venue: game.venue, kickoffUTC: game.kickoffUTC, status: "indoor_verified", weatherGate: true, forecast: null, fetchedAt: generatedAt });
      continue;
    }
    const coordinates = VENUES[game.venue];
    const daysAway = (Date.parse(game.kickoffUTC) - now) / 864e5;
    if (!coordinates || daysAway > 16) {
      rows.push({ gameId: game.gameId, venue: game.venue, kickoffUTC: game.kickoffUTC, status: coordinates ? "outside_forecast_horizon" : "venue_coordinates_missing", weatherGate: false, forecast: null, fetchedAt: null });
      continue;
    }
    try {
      const [latitude, longitude] = coordinates;
      const date = game.kickoffUTC.slice(0, 10);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&start_date=${date}&end_date=${date}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const index = data.hourly.time.reduce((best, time, current) => Math.abs(Date.parse(`${time}Z`) - Date.parse(game.kickoffUTC)) < Math.abs(Date.parse(`${data.hourly.time[best]}Z`) - Date.parse(game.kickoffUTC)) ? current : best, 0);
      rows.push({ gameId: game.gameId, venue: game.venue, kickoffUTC: game.kickoffUTC, status: "forecast_available", weatherGate: true, fetchedAt: generatedAt, forecast: { temperatureF: data.hourly.temperature_2m[index], precipitationProbability: data.hourly.precipitation_probability[index], windMph: data.hourly.wind_speed_10m[index], gustMph: data.hourly.wind_gusts_10m[index] } });
    } catch (error) {
      rows.push({ gameId: game.gameId, venue: game.venue, kickoffUTC: game.kickoffUTC, status: "provider_failed", weatherGate: false, forecast: null, fetchedAt: null, error: error.message });
    }
  }
  return { sport: "NFL", schemaVersion: "1.0", generatedAt, week, status: rows.every(row => row.weatherGate) ? "available" : "partial", provider: "Open-Meteo", freshnessPolicy: { maximumAgeHours: forecastMaxAgeHours, staleForecastsAccepted: false, forecastHorizonDays: 16 }, counts: { games: rows.length, gatedReady: rows.filter(row => row.weatherGate).length, pending: rows.filter(row => !row.weatherGate).length }, games: rows };
}

async function oddsContract(games, pool, week) {
  const base = { sport: "NFL", schemaVersion: "1.0", generatedAt, week, status: "unavailable", provider: "The Odds API", providerSportKey: "americanfootball_nfl", freshnessPolicy: { maximumQuoteAgeMinutes: maxQuoteAgeMinutes, staleQuotesAccepted: false, unmatchedQuotesAccepted: false }, reasonCode: null, events: [], playerPrices: [], rejections: [], counts: { games: games.length, matchedGames: 0, freshPlayerPrices: 0, staleRejected: 0 } };
  const apiKey = String(process.env.ODDS_API_KEY || "").trim();
  if (!apiKey) return { ...base, reasonCode: "missing_api_key" };
  try {
    const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=h2h,totals&oddsFormat=american`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const providerEvents = await response.json();
    const byTeams = new Map(games.map(game => [[normalize(game.homeTeam.displayName), normalize(game.awayTeam.displayName)].sort().join("|"), game]));
    const playerByGameAndName = new Map();
    for (const game of games) for (const player of pool.players.filter(row => [game.homeTeam.abbreviation, game.awayTeam.abbreviation].includes(row.team))) playerByGameAndName.set(`${game.gameId}|${normalize(player.fullName)}`, player);
    for (const event of providerEvents) {
      const game = byTeams.get([normalize(event.home_team), normalize(event.away_team)].sort().join("|"));
      if (!game) continue;
      const quotes = (event.bookmakers || []).flatMap(book => (book.markets || []).map(market => ({ bookmaker: book.key, market: market.key, outcomes: market.outcomes, quoteTimestamp: market.last_update || book.last_update })));
      const fresh = quotes.filter(quote => Number.isFinite(Date.parse(quote.quoteTimestamp)) && now - Date.parse(quote.quoteTimestamp) <= maxQuoteAgeMinutes * 60000);
      base.events.push({ gameId: game.gameId, providerEventId: event.id, commenceTime: event.commence_time, status: fresh.length ? "fresh_game_lines" : "no_fresh_lines", quotes: fresh });
      const propUrl = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${event.id}/odds?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=player_anytime_td,player_reception_yds&oddsFormat=american`;
      const propResponse = await fetch(propUrl, { signal: AbortSignal.timeout(15000) });
      if (!propResponse.ok) { base.rejections.push({ gameId: game.gameId, reasonCode: "player_prop_request_failed", detail: `HTTP ${propResponse.status}` }); continue; }
      const propData = await propResponse.json();
      for (const bookmaker of propData.bookmakers || []) for (const market of bookmaker.markets || []) {
        const quoteTimestamp = market.last_update || bookmaker.last_update;
        const ageMinutes = Number.isFinite(Date.parse(quoteTimestamp)) ? (now - Date.parse(quoteTimestamp)) / 60000 : Infinity;
        for (const outcome of market.outcomes || []) {
          if (!(["player_anytime_td", "player_reception_yds"].includes(market.key))) continue;
          if (market.key === "player_anytime_td" && normalize(outcome.name) !== "yes") continue;
          if (market.key === "player_reception_yds" && normalize(outcome.name) !== "over") continue;
          const playerName = outcome.description || outcome.name;
          const player = playerByGameAndName.get(`${game.gameId}|${normalize(playerName)}`);
          if (!player) { base.rejections.push({ gameId: game.gameId, playerName, bookmaker: bookmaker.key, market: market.key, reasonCode: "player_identity_not_matched" }); continue; }
          if (ageMinutes > maxQuoteAgeMinutes) { base.counts.staleRejected++; base.rejections.push({ gameId: game.gameId, playerId: player.playerId, bookmaker: bookmaker.key, market: market.key, reasonCode: "stale_quote", ageMinutes: Math.round(ageMinutes * 10) / 10 }); continue; }
          base.playerPrices.push({ playerId: player.playerId, playerName: player.fullName, team: player.team, gameId: game.gameId, providerEventId: event.id, market: market.key, point: outcome.point ?? null, priceAmerican: outcome.price, bookmaker: bookmaker.key, quoteTimestamp });
        }
      }
    }
    base.counts.matchedGames = base.events.length;
    base.counts.freshPlayerPrices = base.playerPrices.length;
    base.status = base.playerPrices.length ? "available_player_props" : base.events.some(event => event.status === "fresh_game_lines") ? "partial_game_lines" : "unavailable";
    base.reasonCode = base.status === "unavailable" ? "no_fresh_quotes" : base.playerPrices.length ? null : "no_fresh_player_props";
    return base;
  } catch (error) { return { ...base, reasonCode: "provider_request_failed", detail: error.message }; }
}

function receivingBoard(roles, matchup, practice, weather, odds) {
  const assignment = new Map(matchup.playerAssignments.map(row => [row.playerId, row]));
  const context = new Map(matchup.teamContexts.map(row => [row.team, row]));
  const practiceByPlayer = new Map(practice.players.map(row => [row.playerId, row]));
  const receivingPriceByPlayer = new Map(odds.playerPrices.filter(row => row.market === "player_reception_yds").map(row => [row.playerId, row]));
  const rows = roles.roles.filter(role => ["WR", "TE", "RB"].includes(role.position) && role.historicalOpportunity && role.modelEligibility).map(role => {
    const game = assignment.get(role.playerId); const team = context.get(role.team); const p = practiceByPlayer.get(role.playerId); const price = receivingPriceByPlayer.get(role.playerId);
    const baseline = role.historicalOpportunity.weightedPerGame; const recent = role.historicalOpportunity.recentSixGamesPerGame;
    const targetScore = Math.min(100, Number(baseline.targets || 0) * 10); const yardScore = Math.min(100, Number(baseline.receivingYards || 0) * 1.25);
    const recentScore = baseline.receivingYards ? Math.max(0, Math.min(100, 50 + ((Number(recent.receivingYards || 0) / baseline.receivingYards) - 1) * 45)) : 35;
    const matchupScore = team?.opponentDefense?.vulnerabilityPercentileByPosition?.[role.position] ?? 50;
    const signal = Math.round((targetScore * .38 + yardScore * .32 + role.roleScore * .18 + recentScore * .07 + matchupScore * .05) * 10) / 10;
    return { playerId: role.playerId, playerName: role.playerName, team: role.team, opponent: game?.opponent, gameId: game?.gameId, position: role.position, receivingSignalScore: signal, scoreType: "private_shadow_signal_not_yardage_projection", historicalPerGame: { targets: baseline.targets, receivingYards: baseline.receivingYards }, sportsbook: price || null, gates: { verifiedOpponent: Boolean(game), activeRoster: p?.activeRosterGate === true, regularSeasonRoleConfirmed: p?.regularSeasonRoleConfirmed === true, routeParticipation: false, freshSportsbookLine: Boolean(price), weather: weather.games.find(row => row.gameId === game?.gameId)?.weatherGate === true }, publicationStatus: "private_shadow_only" };
  }).sort((a, b) => b.receivingSignalScore - a.receivingSignalScore).map((row, index) => ({ ...row, shadowRank: index + 1 }));
  return { sport: "NFL", schemaVersion: "1.0", generatedAt, week: matchup.week, status: "private_shadow_board", market: "receiving_yards", projectionStatus: "disabled_until_routes_roles_and_fresh_line", recommendationStatus: "disabled", counts: { rankedPlayers: rows.length, publishableRecommendations: 0, freshSportsbookLines: rows.filter(row => row.gates.freshSportsbookLine).length }, rows };
}

function resultsContract(td, receiving, schedule, existing) {
  const completed = schedule.games.filter(game => game.completed && game.seasonType === 2);
  const snapshotDate = generatedAt.slice(0, 10);
  const snapshots = Array.isArray(existing?.snapshots) ? existing.snapshots.slice() : [];
  if (!snapshots.some(row => row.snapshotDate === snapshotDate && row.week === td.week)) snapshots.push({ snapshotId: `${snapshotDate}|week-${td.week}`, snapshotDate, snapshotAt: generatedAt, week: td.week, status: "locked_pre_kickoff_shadow_snapshot", anytimeTouchdown: td.rows.slice(0, 30).map(row => ({ playerId: row.playerId, rank: row.shadowRank, score: row.tdSignalScore, gameId: row.gameId })), receivingYards: receiving.rows.slice(0, 30).map(row => ({ playerId: row.playerId, rank: row.shadowRank, score: row.receivingSignalScore, gameId: row.gameId })) });
  return { sport: "NFL", schemaVersion: "1.0", generatedAt, week: td.week, status: completed.length ? "regular_season_results_available" : "waiting_for_completed_regular_season_games", methodology: { snapshotRequiredBeforeKickoff: true, retroactiveSelectionsForbidden: true, gradingProvider: "ESPN completed-game data" }, counts: { completedGames: completed.length, snapshots: snapshots.length, tdSelectionsGraded: 0, receivingSelectionsGraded: 0 }, trackedMarkets: [{ market: "anytime_touchdown", shadowRows: td.rows.length }, { market: "receiving_yards", shadowRows: receiving.rows.length }], snapshots, games: existing?.games || [], playerResults: existing?.playerResults || [] };
}

async function main() {
  const schedule = read("nfl_schedule.json"), pool = read("nfl_player_pool.json"), injuries = read("nfl_injuries.json"), roles = read("nfl_role_engine.json"), matchup = read("nfl_matchup_context.json"), td = read("nfl_td_decision_center.json"), health = read("nfl_data_health.json");
  const week = nextWeek(schedule); const games = schedule.games.filter(game => game.week === week && !game.completed);
  const practice = practiceContract(pool, injuries, roles, week); write("nfl_practice_reports.json", practice);
  const weather = await weatherContract(games, week); write("nfl_weather.json", weather);
  const odds = await oddsContract(games, pool, week); write("nfl_sportsbook_lines.json", odds);
  const receiving = receivingBoard(roles, matchup, practice, weather, odds); write("nfl_receiving_yards_board.json", receiving);
  const existingResultsPath = path.join(DATA, "nfl_results_tracking.json");
  const results = resultsContract(td, receiving, schedule, fs.existsSync(existingResultsPath) ? read("nfl_results_tracking.json") : null); write("nfl_results_tracking.json", results);
  health.generatedAt = generatedAt;
  health.sources.practiceReports = { status: practice.status, provider: practice.provider, roleConfirmed: practice.counts.roleConfirmed };
  health.sources.weather = { status: weather.status, provider: weather.provider, readyGames: weather.counts.gatedReady, games: weather.counts.games };
  health.sources.sportsbookLines = { status: odds.status, provider: odds.provider, reasonCode: odds.reasonCode, freshPlayerPrices: odds.counts.freshPlayerPrices };
  health.sources.receivingYards = { status: "private_shadow_only", rankedPlayers: receiving.counts.rankedPlayers, publishableRecommendations: 0 };
  health.sources.resultsTracking = { status: results.status, completedGames: results.counts.completedGames };
  health.status = "nfl_dress_rehearsal_private_gates_active"; write("nfl_data_health.json", health);
  console.log(`NFL dress rehearsal: ${practice.counts.roleConfirmed} roles confirmed, ${weather.counts.gatedReady}/${weather.counts.games} weather ready, ${odds.counts.freshPlayerPrices} fresh player prices, ${receiving.counts.rankedPlayers} receiving signals`);
}

main().catch(error => { console.error("NFL DRESS REHEARSAL BUILD FAILED"); console.error(error); process.exit(1); });
