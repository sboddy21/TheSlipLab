const elements = {
  status: document.getElementById("accountStatus"),
  signedOut: document.getElementById("signedOutPanel"),
  signedIn: document.getElementById("signedInPanel"),
  signInTab: document.getElementById("signInTab"),
  signUpTab: document.getElementById("signUpTab"),
  signInForm: document.getElementById("signInForm"),
  signInEmail: document.getElementById("signInEmail"),
  signInPassword: document.getElementById("signInPassword"),
  signUpForm: document.getElementById("signUpForm"),
  signUpEmail: document.getElementById("signUpEmail"),
  signUpPassword: document.getElementById("signUpPassword"),
  signUpPasswordConfirm: document.getElementById("signUpPasswordConfirm"),
  resetRequestForm: document.getElementById("resetRequestForm"),
  resetEmail: document.getElementById("resetEmail"),
  newPasswordForm: document.getElementById("newPasswordForm"),
  newPassword: document.getElementById("newPassword"),
  newPasswordConfirm: document.getElementById("newPasswordConfirm"),
  showReset: document.getElementById("showResetButton"),
  cancelReset: document.getElementById("cancelResetButton"),
  message: document.getElementById("signInMessage"),
  emailDisplay: document.getElementById("accountEmailDisplay"),
  signOut: document.getElementById("signOutButton"),
  membership: document.querySelector(".account-membership"),
  membershipStatus: document.getElementById("accountMembershipStatus"),
  subscribe: document.getElementById("accountSubscribeButton"),
  search: document.getElementById("favoriteSearch"),
  results: document.getElementById("favoriteSearchResults"),
  list: document.getElementById("favoriteList"),
  summary: document.getElementById("favoritesSummary"),
  dashboardSummary: document.getElementById("accountDashboardSummary"),
  topSavedLook: document.getElementById("accountTopSavedLook"),
  nextActions: document.getElementById("accountNextActions"),
  dailyLabSummary: document.getElementById("dailyLabSummary"),
  dailyLabList: document.getElementById("dailyLabList"),
  dailyLabFreshness: document.getElementById("dailyLabFreshness"),
  liveAlertsSummary: document.getElementById("liveAlertsSummary"),
  liveAlertsList: document.getElementById("liveAlertsList"),
  liveAlertsFreshness: document.getElementById("liveAlertsFreshness"),
  detailDialog: document.getElementById("favoriteDetailDialog"),
  detailTitle: document.getElementById("favoriteDetailTitle"),
  detailBody: document.getElementById("favoriteDetailBody"),
  detailClose: document.getElementById("favoriteDetailClose")
};

let catalog = [];
let favorites = [];
let recoveryMode = false;
let detailData = {
  playerCards: [],
  decisionPlayers: [],
  reasoningReports: [],
  homeRunBoard: [],
  matchups: [],
  currentResults: {},
  previousResults: {},
  historyDays: [],
  liveAlerts: { alerts: [], status: "unavailable" },
  dailyTimestamps: []
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function setMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle("error", isError);
}

function redirectTarget() {
  const params = new URLSearchParams(window.location.search);
  const rawTarget = params.get("redirect");
  if (!rawTarget) return "";
  try {
    const decodedTarget = decodeURIComponent(rawTarget);
    if (!decodedTarget.startsWith("/") || decodedTarget.startsWith("//") || decodedTarget.includes("://")) return "";
    if (decodedTarget === "/account.html" || decodedTarget.startsWith("/account.html?")) return "";
    return decodedTarget;
  } catch {
    return "";
  }
}

function redirectAfterAuth(session) {
  const target = redirectTarget();
  if (!session?.user || !target || recoveryMode) return false;
  window.location.replace(target);
  return true;
}

function signInPrompt() {
  return redirectTarget()
    ? "Sign in to continue to the member page you requested."
    : "Sign in with your email and password.";
}

function authErrorMessage(error) {
  const message = String(error?.message || "Account request failed");
  if (/invalid login credentials/i.test(message)) return "That email and password combination was not recognized.";
  if (/email not confirmed/i.test(message)) return "Confirm your email address before signing in.";
  if (/user already registered/i.test(message)) return "An account already exists for that email. Sign in or reset the password.";
  if (/rate limit/i.test(message)) return "Too many authentication emails were requested. Please wait before trying again.";
  return message;
}

function setButtonBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) button.dataset.originalLabel = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.originalLabel || button.textContent;
}

function showAuthView(view) {
  const isSignIn = view === "signin";
  const isSignUp = view === "signup";
  const isReset = view === "reset";
  elements.signInForm.hidden = !isSignIn;
  elements.signUpForm.hidden = !isSignUp;
  elements.resetRequestForm.hidden = !isReset;
  elements.newPasswordForm.hidden = view !== "new-password";
  elements.signInTab.closest(".account-auth-tabs").hidden = isReset || view === "new-password";
  elements.signInTab.classList.toggle("active", isSignIn);
  elements.signUpTab.classList.toggle("active", isSignUp);
  elements.signInTab.setAttribute("aria-selected", String(isSignIn));
  elements.signUpTab.setAttribute("aria-selected", String(isSignUp));
}

function passwordsMatch(password, confirmation) {
  if (password.length < 8) {
    setMessage("Use a password with at least 8 characters.", true);
    return false;
  }
  if (password !== confirmation) {
    setMessage("The passwords do not match.", true);
    return false;
  }
  return true;
}

function normalizeCatalog(playerPool, matchups) {
  const players = (playerPool.players || []).map(player => ({
    sport: "MLB",
    entityType: "player",
    externalId: player.playerId,
    displayName: player.player,
    teamName: player.team,
    context: player.confirmedLineup ? `Confirmed lineup #${player.lineupSpot}` : player.lineupStatus || "Current roster"
  }));

  const pitcherMap = new Map();
  (matchups.games || []).forEach(game => {
    [
      [game.awayProbablePitcherId, game.awayProbablePitcher, game.awayTeam],
      [game.homeProbablePitcherId, game.homeProbablePitcher, game.homeTeam]
    ].forEach(([externalId, displayName, teamName]) => {
      if (!externalId || !displayName) return;
      pitcherMap.set(String(externalId), {
        sport: "MLB",
        entityType: "pitcher",
        externalId,
        displayName,
        teamName,
        context: `Probable starter · ${game.matchup}`
      });
    });
  });

  return [...players, ...pitcherMap.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function loadCatalog() {
  const version = Date.now();
  const [playerPool, matchups, playerCards, decisionCenter, reasoning, homeRunBoard, currentResults, previousResults, history, liveAlerts] = await Promise.all([
    fetchOptionalJSON(`./data/mlb_player_pool.json?v=${version}`, { players: [] }),
    fetchOptionalJSON(`./data/game_pitcher_matchups.json?v=${version}`, { games: [] }),
    fetchOptionalJSON(`./data/player_card_data.json?v=${version}`, { players: [] }),
    fetchOptionalJSON(`./data/hr_decision_center.json?v=${version}`, { allPlayers: [] }),
    fetchOptionalJSON(`./data/ai_reasoning_engine.json?v=${version}`, { reports: [] }),
    fetchOptionalJSON(`./data/mlb_home_runs.json?v=${version}`, []),
    fetchOptionalJSON(`./data/mlb_results.json?v=${version}`, { playerEvents: [], homeRuns: [] }),
    fetchOptionalJSON(`./data/mlb_results_previous.json?v=${version}`, { playerEvents: [], homeRuns: [] }),
    fetchOptionalJSON(`./data/hr_results_history.json?v=${version}`, { days: [] }),
    fetchOptionalJSON(`./data/live_change_alerts.json?v=${version}`, { alerts: [], status: "unavailable" })
  ]);
  catalog = normalizeCatalog(playerPool, matchups);
  detailData = {
    playerCards: Array.isArray(playerCards.players) ? playerCards.players : [],
    decisionPlayers: Array.isArray(decisionCenter.allPlayers) ? decisionCenter.allPlayers : [],
    reasoningReports: Array.isArray(reasoning.reports) ? reasoning.reports : [],
    homeRunBoard: Array.isArray(homeRunBoard) ? homeRunBoard : [],
    matchups: Array.isArray(matchups.games) ? matchups.games : [],
    currentResults,
    previousResults,
    historyDays: Array.isArray(history.days) ? history.days : [],
    liveAlerts,
    dailyTimestamps: [playerPool.fetchedAt, playerPool.updatedAt, matchups.updatedAt, playerCards.updatedAt, decisionCenter.updatedAt, reasoning.updatedAt, currentResults.updatedAt, liveAlerts.generatedAt]
      .filter(Boolean)
  };
}

async function fetchOptionalJSON(url, fallback) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

function favoriteKey(item) {
  return `${item.entity_type || item.entityType}:${item.external_id || item.externalId}`;
}

function catalogItemForPlayer(row) {
  const playerId = row?.playerId || row?.mlbId || row?.batterId;
  const existing = catalog.find(item => item.entityType === "player" && String(item.externalId) === String(playerId));
  if (existing) return existing;
  if (!row?.player || !playerId) return null;
  return {
    sport: "MLB",
    entityType: "player",
    externalId: playerId,
    displayName: row.player,
    teamName: row.team,
    context: `${row.game || [row.team, row.opponent].filter(Boolean).join(" vs ")}${row.opposingPitcher ? ` · vs ${row.opposingPitcher}` : ""}`
  };
}

function suggestedSaveItems(saved) {
  const boardRows = [
    ...detailData.decisionPlayers
      .filter(row => row?.promotionEligible !== false && row?.availabilityOverride?.status !== "out")
      .map(row => ({ row, score: Number(row.hrConfidence ?? row.ceilingScore ?? row.powerScore ?? 0) })),
    ...detailData.homeRunBoard
      .map(row => ({ row, score: Number(row.hrConfidence ?? row.finalHrScore ?? row.score ?? 0) }))
  ].sort((a, b) => b.score - a.score);
  const seen = new Set();
  return boardRows
    .map(({ row }) => catalogItemForPlayer(row))
    .filter(Boolean)
    .filter(item => {
      const key = favoriteKey(item);
      if (saved.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function renderSaveOption(item, label = "Save") {
  const saved = new Set(favorites.map(favoriteKey));
  const disabled = saved.has(favoriteKey(item));
  return `<div class="favorite-option"><div><strong>${escapeHtml(item.displayName)}</strong><span>${escapeHtml(item.teamName)} · ${escapeHtml(item.context)}</span></div><button class="account-button secondary" type="button" data-save-favorite="${escapeHtml(item.entityType)}:${escapeHtml(item.externalId)}" ${disabled ? "disabled" : ""}>${disabled ? "Saved" : label}</button></div>`;
}

function renderSearchResults() {
  const query = elements.search.value.trim().toLowerCase();
  const saved = new Set(favorites.map(favoriteKey));
  if (query.length < 2) {
    const suggestions = suggestedSaveItems(saved);
    elements.results.innerHTML = suggestions.length
      ? `<div class="favorite-suggestion-heading"><strong>Suggested saves from today’s board</strong><span>Start here, or type two letters to search everyone.</span></div>${suggestions.map(item => renderSaveOption(item, "Save")).join("")}`
      : '<div class="empty-state">Enter at least two letters to search today’s live MLB pool.</div>';
    return;
  }
  const matches = catalog.filter(item => [item.displayName, item.teamName].some(value => String(value || "").toLowerCase().includes(query))).slice(0, 12);
  elements.results.innerHTML = matches.length ? matches.map(item => renderSaveOption(item, "Save")).join("") : '<div class="empty-state">No current MLB player or probable pitcher matched that search.</div>';
}

function renderFavorites() {
  elements.summary.textContent = favorites.length === 1 ? "1 saved favorite" : `${favorites.length} saved favorites`;
  elements.list.innerHTML = favorites.length ? favorites.map(item => `<div class="favorite-card"><button class="favorite-card-open" type="button" data-open-favorite="${item.id}" aria-label="Open details for ${escapeHtml(item.display_name)}"><span class="favorite-card-type">${escapeHtml(item.sport)} ${escapeHtml(item.entity_type)}</span><strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.team_name || "Team unavailable")}</span><small>View verified game and event data →</small></button><button class="account-button danger" type="button" data-remove-favorite="${item.id}">Remove</button></div>`).join("") : '<div class="empty-state">No favorites saved yet. Search today’s player pool to build your board.</div>';
  renderAccountDashboard();
  renderDailyLab();
  renderLiveAlerts();
  renderSearchResults();
}

function normalizedName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function samePlayer(row, favorite) {
  const rowId = String(row?.playerId || row?.batterId || "").trim();
  const favoriteId = String(favorite?.external_id || "").trim();
  if (rowId && favoriteId) return rowId === favoriteId;
  return normalizedName(row?.player || row?.batter) === normalizedName(favorite?.display_name);
}

function samePitcher(row, favorite) {
  const rowId = String(row?.pitcherId || "").trim();
  const favoriteId = String(favorite?.external_id || "").trim();
  if (rowId && favoriteId) return rowId === favoriteId;
  return normalizedName(row?.pitcher) === normalizedName(favorite?.display_name);
}

function sameNamedEntity(row, favorite) {
  return favorite.entity_type === "pitcher" ? samePitcher(row, favorite) : samePlayer(row, favorite);
}

function matchupPitchers(game) {
  return [
    game?.awayPitcher,
    game?.homePitcher,
    { id: game?.awayProbablePitcherId, name: game?.awayProbablePitcher, team: game?.awayTeam, opponent: game?.homeTeam },
    { id: game?.homeProbablePitcherId, name: game?.homeProbablePitcher, team: game?.homeTeam, opponent: game?.awayTeam }
  ].filter(Boolean);
}

function findFavoriteGame(favorite, playerCard) {
  if (favorite.entity_type === "pitcher") {
    return detailData.matchups.find(game => matchupPitchers(game).some(pitcher => {
      const idMatch = pitcher.id && favorite.external_id && String(pitcher.id) === String(favorite.external_id);
      return idMatch || normalizedName(pitcher.name || pitcher.pitcher) === normalizedName(favorite.display_name);
    }));
  }
  const cardGame = normalizedName(playerCard?.game);
  if (cardGame) {
    const exact = detailData.matchups.find(game => [game.game, game.matchup].some(value => normalizedName(value) === cardGame));
    if (exact) return exact;
  }
  const team = normalizedName(playerCard?.team || favorite.team_name);
  const opponent = normalizedName(playerCard?.opponent);
  return detailData.matchups.find(game => {
    const teams = [normalizedName(game.awayTeam), normalizedName(game.homeTeam)];
    return team && teams.includes(team) && (!opponent || teams.includes(opponent));
  });
}

function favoriteDailyModel(favorite) {
  const playerCard = favorite.entity_type === "player" ? detailData.playerCards.find(row => samePlayer(row, favorite)) : null;
  const decision = favorite.entity_type === "player" ? detailData.decisionPlayers.find(row => samePlayer(row, favorite)) : null;
  const reasoning = favorite.entity_type === "player" ? detailData.reasoningReports.find(row => samePlayer(row, favorite)) : null;
  const board = favorite.entity_type === "player" ? detailData.homeRunBoard.find(row => samePlayer(row, favorite)) : null;
  const game = findFavoriteGame(favorite, playerCard);
  const pitcher = favorite.entity_type === "pitcher"
    ? matchupPitchers(game).find(row => {
      const idMatch = row.id && favorite.external_id && String(row.id) === String(favorite.external_id);
      return idMatch || normalizedName(row.name || row.pitcher) === normalizedName(favorite.display_name);
    })
    : null;
  const currentEvents = [
    ...(Array.isArray(detailData.currentResults?.playerEvents) ? detailData.currentResults.playerEvents : []),
    ...(Array.isArray(detailData.currentResults?.homeRuns) ? detailData.currentResults.homeRuns : [])
  ].filter(row => sameNamedEntity(row, favorite));
  return { favorite, playerCard, decision, reasoning, board, game, pitcher, currentEvents: uniqueRows(currentEvents), onSlate: Boolean(game || playerCard || decision || board) };
}

function gameStateLabel(game) {
  if (!game) return "Off today’s slate";
  const status = game.status || game.abstractStatus || "Scheduled";
  if (String(game.abstractStatus).toLowerCase() === "live" && game.currentInning) {
    return `${game.inningState || game.inningHalf || ""} ${game.currentInning}`.trim();
  }
  return status;
}

function formatDailyFreshness() {
  const valid = detailData.dailyTimestamps.map(value => new Date(value)).filter(date => !Number.isNaN(date.getTime()));
  if (!valid.length) return "Current-data timestamp unavailable";
  const oldest = new Date(Math.min(...valid.map(date => date.getTime())));
  return `All required inputs current through ${oldest.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

function alertMatchesFavorite(alert, favorite) {
  if (alert?.entityType !== favorite?.entity_type) return false;
  const alertId = String(alert?.entityId || "").trim();
  const favoriteId = String(favorite?.external_id || "").trim();
  if (alertId && favoriteId) return alertId === favoriteId;
  return normalizedName(alert?.entityName) === normalizedName(favorite?.display_name);
}

function alertKindLabel(kind) {
  return ({
    lineup_confirmed: "Lineup confirmed",
    lineup_removed: "Lineup change",
    opponent_pitcher_changed: "Pitcher change",
    probability_move: "Probability move",
    model_score_move: "Model move",
    signal_change: "Signal change",
    pitcher_vulnerability_move: "Pitcher risk move"
  })[kind] || "Verified change";
}

function renderLiveAlerts() {
  if (!elements.liveAlertsList || !elements.liveAlertsSummary || !elements.liveAlertsFreshness) return;
  const payload = detailData.liveAlerts || {};
  const allAlerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  const matching = allAlerts.filter(alert => favorites.some(favorite => alertMatchesFavorite(alert, favorite)));
  const players = favorites.filter(favorite => favorite.entity_type === "player").length;
  const pitchers = favorites.filter(favorite => favorite.entity_type === "pitcher").length;
  elements.liveAlertsSummary.innerHTML = [
    ["Verified changes", matching.length], ["Saved players", players], ["Saved pitchers", pitchers]
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");

  const generated = new Date(payload.generatedAt || "");
  elements.liveAlertsFreshness.textContent = Number.isNaN(generated.getTime())
    ? "Alert timestamp unavailable"
    : `Checked ${generated.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;

  if (!favorites.length) {
    elements.liveAlertsList.innerHTML = '<div class="empty-state">Save an MLB player or pitcher to monitor verified changes.</div>';
    return;
  }
  if (payload.status === "unavailable") {
    elements.liveAlertsList.innerHTML = '<div class="empty-state">The verified change feed is temporarily unavailable. No stale alerts are being shown.</div>';
    return;
  }
  if (payload.status === "baseline_established") {
    elements.liveAlertsList.innerHTML = '<div class="empty-state">Today’s monitoring baseline is set. Verified changes will appear after a later refresh detects one.</div>';
    return;
  }
  if (payload.status === "no_games_scheduled") {
    elements.liveAlertsList.innerHTML = '<div class="empty-state">No MLB games are scheduled today, so there are no live changes to monitor.</div>';
    return;
  }
  elements.liveAlertsList.innerHTML = matching.length ? matching.map(alert => {
    const created = new Date(alert.createdAt || "");
    const time = Number.isNaN(created.getTime()) ? "Time unavailable" : created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const sources = Array.isArray(alert.sourceFiles) ? alert.sourceFiles.join(" · ") : "Verified production data";
    return `<article class="live-alert-card ${escapeHtml(alert.severity || "info")}"><div class="live-alert-card-head"><span>${escapeHtml(alertKindLabel(alert.kind))}</span><time>${escapeHtml(time)}</time></div><h4>${escapeHtml(alert.title || alert.entityName)}</h4><p>${escapeHtml(alert.message || "A verified live change was detected.")}</p><small>Source: ${escapeHtml(sources)}</small></article>`;
  }).join("") : '<div class="empty-state">No verified changes have been detected for your saved players or pitchers yet today.</div>';
}

function matchingLiveAlerts() {
  const allAlerts = Array.isArray(detailData.liveAlerts?.alerts) ? detailData.liveAlerts.alerts : [];
  return allAlerts.filter(alert => favorites.some(favorite => alertMatchesFavorite(alert, favorite)));
}

function modelScore(model) {
  if (model.favorite.entity_type === "pitcher") {
    return Number(model.pitcher?.vulnerability ?? 0);
  }
  return Math.max(
    Number(model.decision?.hrConfidence ?? 0),
    Number(model.board?.hrConfidence ?? model.board?.finalHrScore ?? model.board?.score ?? 0),
    Number(model.playerCard?.model?.score ?? 0)
  );
}

function dashboardStat(label, value, note) {
  return `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;
}

function renderAccountDashboard() {
  if (!elements.dashboardSummary || !elements.topSavedLook || !elements.nextActions) return;
  const models = favorites.map(favoriteDailyModel);
  const players = favorites.filter(favorite => favorite.entity_type === "player").length;
  const pitchers = favorites.filter(favorite => favorite.entity_type === "pitcher").length;
  const onSlate = models.filter(model => model.onSlate).length;
  const alerts = matchingLiveAlerts();
  elements.dashboardSummary.innerHTML = `
    <span class="account-command-card-kicker">Saved board</span>
    <div class="account-command-stats-grid">
      ${dashboardStat("Saved", favorites.length, "Total")}
      ${dashboardStat("On slate", onSlate, "Today")}
      ${dashboardStat("Hitters", players, "Saved")}
      ${dashboardStat("Pitchers", pitchers, "Saved")}
      ${dashboardStat("Alerts", alerts.length, "Verified")}
    </div>`;

  const best = models
    .filter(model => model.onSlate && model.favorite.entity_type === "player")
    .sort((a, b) => modelScore(b) - modelScore(a))[0];
  if (best) {
    const score = modelScore(best);
    const opponent = best.playerCard?.opponent || best.decision?.opponent || best.board?.opponent;
    const pitcher = best.playerCard?.opposingPitcher || best.decision?.opposingPitcher || best.board?.opposingPitcher;
    const reasons = dailyReasons(best);
    elements.topSavedLook.innerHTML = `
      <span class="account-command-card-kicker">Best saved look today</span>
      <h4>${escapeHtml(best.favorite.display_name)}</h4>
      <p>${escapeHtml(best.favorite.team_name || best.playerCard?.team || "Team unavailable")}${opponent ? ` vs ${escapeHtml(opponent)}` : ""}</p>
      <div class="account-command-score">${escapeHtml(valueOrDash(score, "%"))}</div>
      <div class="account-command-note">${pitcher ? `Opposing pitcher: ${escapeHtml(pitcher)}` : "Opponent pitcher pending"}</div>
      ${reasons.length ? `<ul>${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
      <button class="account-button" type="button" data-open-dashboard-favorite="${escapeHtml(best.favorite.id)}">Open saved card</button>`;
  } else {
    elements.topSavedLook.innerHTML = `
      <span class="account-command-card-kicker">Best saved look today</span>
      <h4>${favorites.length ? "No saved hitter is active yet" : "Build your first board"}</h4>
      <p>${favorites.length ? "Saved off-slate players stay here for future slates. Add hitters from today’s suggestions to unlock this card." : "Save a few hitters or pitchers and this turns into a personalized daily read."}</p>
      <a class="account-button" href="./hr-decision-center.html">Browse today’s board</a>`;
  }

  const actionItems = favorites.length
    ? [
      `${onSlate} of ${favorites.length} saved favorites are active on today’s MLB slate.`,
      alerts.length ? `${alerts.length} verified change${alerts.length === 1 ? "" : "s"} need a look.` : "No verified changes have hit your saved board yet.",
      pitchers ? "You have probable pitchers saved for matchup monitoring." : "Add probable pitchers to monitor vulnerability and pitcher-change alerts."
    ]
    : [
      "Save 3–5 hitters from the suggestions below.",
      "Add today’s probable pitchers for matchup alerts.",
      "Come back after lineup refreshes and your Daily Lab will tighten automatically."
    ];
  elements.nextActions.innerHTML = `
    <span class="account-command-card-kicker">Next best action</span>
    <h4>${favorites.length ? "Review the saved-board read" : "Start with suggested saves"}</h4>
    <ol>${actionItems.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
}

function dailyOutcome(events, isPitcher) {
  const homeRuns = events.filter(row => row.category === "home_run" || /home run/i.test(row.event || "")).length;
  const closeCalls = events.filter(row => row.isCloseCall).length;
  const airOuts = events.filter(row => ["flyout", "lineout", "pop_out", "sac_fly"].includes(row.category)).length;
  if (homeRuns) return `${homeRuns} verified HR${homeRuns === 1 ? "" : "s"}${isPitcher ? " allowed" : ""}`;
  if (closeCalls) return `${closeCalls} verified close call${closeCalls === 1 ? "" : "s"}`;
  if (airOuts) return `${airOuts} verified air out${airOuts === 1 ? "" : "s"}`;
  return "No verified tracked event yet";
}

function dailyReasons(model) {
  const reasons = [
    ...(Array.isArray(model.decision?.reasons) ? model.decision.reasons : []),
    ...(Array.isArray(model.reasoning?.whyToday) ? model.reasoning.whyToday : []),
    model.reasoning?.oneLine
  ].filter(Boolean);
  return [...new Set(reasons)].slice(0, 2);
}

function dailyMetric(label, value) {
  return `<div class="daily-lab-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(valueOrDash(value))}</strong></div>`;
}

function dailySignalMarkup(signals) {
  if (!signals.length) return "";
  return `<div class="daily-lab-signals">${signals.slice(0, 5).map(signal => `<span>${escapeHtml(signal.emoji || "")}${signal.emoji ? " " : ""}${escapeHtml(signal.label || signal)}</span>`).join("")}</div>`;
}

function dailyPlayerCard(model) {
  const { favorite, playerCard, decision, reasoning, board, game, currentEvents } = model;
  const confidence = decision?.hrConfidence ?? playerCard?.model?.score ?? board?.hrConfidence;
  const tier = decision?.tier || playerCard?.model?.tier || board?.powerTier || reasoning?.aiVerdict;
  const lineup = decision?.lineupStatus || playerCard?.lineupStatus || "Lineup pending";
  const opponent = playerCard?.opponent || decision?.opponent || board?.opponent;
  const pitcher = playerCard?.opposingPitcher || decision?.opposingPitcher || decision?.pitcher || board?.opposingPitcher;
  const signals = Array.isArray(playerCard?.slateSignals) ? playerCard.slateSignals : [];
  const reasons = dailyReasons(model);
  return `<article class="daily-lab-card player ${!model.onSlate ? "off-slate" : ""}">
    <button class="daily-lab-open" type="button" data-open-daily-favorite="${favorite.id}" aria-label="Open details for ${escapeHtml(favorite.display_name)}">
      <div class="daily-lab-card-head"><div><span class="daily-lab-type">Saved hitter</span><h4>${escapeHtml(favorite.display_name)}</h4><p>${escapeHtml(favorite.team_name || playerCard?.team || "Team unavailable")}${opponent ? ` vs ${escapeHtml(opponent)}` : ""}</p></div><span class="daily-lab-state">${escapeHtml(gameStateLabel(game))}</span></div>
      ${model.onSlate ? `<div class="daily-lab-context"><strong>${escapeHtml(lineup)}</strong><span>${pitcher ? `Opposing pitcher: ${escapeHtml(pitcher)}` : "Opposing pitcher pending"}</span></div>
      <div class="daily-lab-metrics">${dailyMetric("HR confidence", confidence === undefined ? "—" : `${confidence}%`)}${dailyMetric("Tier", tier)}${dailyMetric("Season HR", playerCard?.season?.hr ?? decision?.seasonHr)}${dailyMetric("Last 7 HR", playerCard?.last7?.hr)}</div>
      <div class="daily-lab-metrics compact">${dailyMetric("Power", decision?.powerScore ?? playerCard?.model?.powerScore)}${dailyMetric("Pitch edge", decision?.pitchEdge ?? playerCard?.model?.pitchEdge)}${dailyMetric("Pitcher risk", decision?.pitcherRisk ?? playerCard?.model?.pitcherRisk)}</div>
      ${dailySignalMarkup(signals)}
      ${reasons.length ? `<ul class="daily-lab-reasons">${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
      <div class="daily-lab-outcome">${escapeHtml(dailyOutcome(currentEvents, false))}</div>` : '<div class="daily-lab-off-slate">Saved for future slates. No current-game model values are shown.</div>'}
      <span class="daily-lab-details">Open verified player history →</span>
    </button>
  </article>`;
}

function dailyPitcherCard(model) {
  const { favorite, game, pitcher, currentEvents } = model;
  const stats = pitcher?.stats || {};
  return `<article class="daily-lab-card pitcher ${!model.onSlate ? "off-slate" : ""}">
    <button class="daily-lab-open" type="button" data-open-daily-favorite="${favorite.id}" aria-label="Open details for ${escapeHtml(favorite.display_name)}">
      <div class="daily-lab-card-head"><div><span class="daily-lab-type">Saved pitcher</span><h4>${escapeHtml(favorite.display_name)}</h4><p>${escapeHtml(favorite.team_name || pitcher?.team || "Team unavailable")}${pitcher?.opponent ? ` vs ${escapeHtml(pitcher.opponent)}` : ""}</p></div><span class="daily-lab-state">${escapeHtml(gameStateLabel(game))}</span></div>
      ${model.onSlate ? `<div class="daily-lab-context"><strong>${escapeHtml(game?.matchup || game?.game || "Today’s matchup")}</strong><span>${escapeHtml(game?.venue || "Venue unavailable")}</span></div>
      <div class="daily-lab-metrics">${dailyMetric("Vulnerability", pitcher?.vulnerability)}${dailyMetric("ERA", stats.era)}${dailyMetric("WHIP", stats.whip)}${dailyMetric("HR/9", stats.hrPer9)}</div>
      <div class="daily-lab-outcome">${escapeHtml(dailyOutcome(currentEvents, true))}</div>` : '<div class="daily-lab-off-slate">Saved for future slates. No current-game pitcher values are shown.</div>'}
      <span class="daily-lab-details">Open verified pitcher history →</span>
    </button>
  </article>`;
}

function renderDailyLab() {
  if (!elements.dailyLabList || !elements.dailyLabSummary || !elements.dailyLabFreshness) return;
  const models = favorites.map(favoriteDailyModel).sort((a, b) => Number(b.onSlate) - Number(a.onSlate) || a.favorite.entity_type.localeCompare(b.favorite.entity_type) || a.favorite.display_name.localeCompare(b.favorite.display_name));
  const onSlate = models.filter(model => model.onSlate).length;
  const confirmed = models.filter(model => model.decision?.confirmedLineup || /confirmed/i.test(model.playerCard?.lineupStatus || "")).length;
  const active = models.filter(model => ["live", "final"].includes(String(model.game?.abstractStatus || "").toLowerCase())).length;
  elements.dailyLabFreshness.textContent = formatDailyFreshness();
  elements.dailyLabSummary.innerHTML = [
    ["Saved", models.length], ["On slate", onSlate], ["Confirmed", confirmed], ["Live / final", active]
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  elements.dailyLabList.innerHTML = models.length
    ? models.map(model => model.favorite.entity_type === "pitcher" ? dailyPitcherCard(model) : dailyPlayerCard(model)).join("")
    : '<div class="empty-state">Save an MLB player or pitcher to build your personalized daily board.</div>';
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const key = [
      row.date || String(row.endTime || "").slice(0, 10),
      row.playerId || normalizedName(row.player || row.batter),
      row.pitcherId || normalizedName(row.pitcher),
      row.inning,
      row.category || row.eventType,
      row.description,
      row.distance
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectedEvents() {
  const direct = [detailData.currentResults, detailData.previousResults]
    .flatMap(payload => Array.isArray(payload?.playerEvents) ? payload.playerEvents : []);
  const history = detailData.historyDays.flatMap(day => Array.isArray(day?.playerEvents) ? day.playerEvents : []);
  return uniqueRows([...direct, ...history]).sort((a, b) => String(b.endTime || b.date || "").localeCompare(String(a.endTime || a.date || "")));
}

function collectedHomeRuns() {
  const direct = [detailData.currentResults, detailData.previousResults]
    .flatMap(payload => Array.isArray(payload?.homeRuns) ? payload.homeRuns : []);
  const history = detailData.historyDays.flatMap(day => (day.homeRuns || []).map(row => ({ ...row, date: row.date || day.date, category: "home_run" })));
  return uniqueRows([...direct, ...history]);
}

function metric(label, value) {
  return `<div class="favorite-detail-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function valueOrDash(value, suffix = "") {
  return value === "" || value === null || value === undefined ? "—" : `${value}${suffix}`;
}

function eventLabel(row) {
  const labels = { home_run: "Home run", sac_fly: "Sac fly", flyout: "Flyout", lineout: "Lineout", pop_out: "Pop out" };
  return row.isCloseCall ? `Close call · ${labels[row.category] || row.event}` : labels[row.category] || row.event || "Batted-ball event";
}

function renderEventRows(rows) {
  if (!rows.length) return '<div class="empty-state">No verified airborne plate appearances are available for this player yet.</div>';
  return `<div class="favorite-event-list">${rows.slice(0, 16).map(row => `<article class="favorite-event-card ${row.isCloseCall ? "close-call" : ""}"><div class="favorite-event-title"><strong>${escapeHtml(eventLabel(row))}</strong><span>${escapeHtml(row.date || "Date unavailable")}</span></div><p>${escapeHtml(row.description || `${row.player || "Player"} recorded a ${String(row.event || "batted-ball event").toLowerCase()}.`)}</p><div class="favorite-event-facts"><span>${escapeHtml(row.game || "Game unavailable")}</span><span>${escapeHtml(row.inning || "Inning unavailable")}</span><span>vs ${escapeHtml(row.pitcher || "pitcher unavailable")}</span><span>${escapeHtml(valueOrDash(row.distance, " ft"))}</span><span>${escapeHtml(valueOrDash(row.exitVelocity, " mph EV"))}</span><span>${escapeHtml(valueOrDash(row.launchAngle, "° LA"))}</span></div></article>`).join("")}</div>`;
}

function openFavoriteDetails(favorite) {
  const isPitcher = favorite.entity_type === "pitcher";
  const allEvents = collectedEvents();
  const rows = allEvents.filter(row => isPitcher ? samePitcher(row, favorite) : samePlayer(row, favorite));
  const historicalHomeRuns = collectedHomeRuns().filter(row => isPitcher ? samePitcher(row, favorite) : samePlayer(row, favorite));
  const homeRuns = uniqueRows([...rows.filter(row => row.category === "home_run"), ...historicalHomeRuns]);
  const playerCard = !isPitcher ? detailData.playerCards.find(row => samePlayer(row, favorite)) : null;
  const airOuts = rows.filter(row => ["flyout", "lineout", "pop_out"].includes(row.category)).length;
  const sacFlies = rows.filter(row => row.category === "sac_fly").length;
  const closeCalls = rows.filter(row => row.isCloseCall).length;
  const gameLine = playerCard
    ? `${playerCard.team || favorite.team_name || "Team unavailable"} vs ${playerCard.opponent || "opponent TBD"} · ${playerCard.opposingPitcher ? `vs ${playerCard.opposingPitcher}` : "pitcher TBD"}`
    : catalog.find(item => item.entityType === favorite.entity_type && String(item.externalId) === String(favorite.external_id))?.context || "No current scheduled-game context is available.";

  elements.detailTitle.textContent = favorite.display_name;
  elements.detailBody.innerHTML = `
    <section class="favorite-detail-summary">
      <span class="favorite-card-type">${escapeHtml(favorite.sport)} ${escapeHtml(favorite.entity_type)}</span>
      <p>${escapeHtml(gameLine)}</p>
      ${playerCard ? `<p class="favorite-lineup-note">${escapeHtml(playerCard.lineupStatus || "Lineup status unavailable")} · Season ${escapeHtml(valueOrDash(playerCard.season?.hr))} HR · Last 7 ${escapeHtml(valueOrDash(playerCard.last7?.hr))} HR</p>` : ""}
    </section>
    <div class="favorite-detail-metrics">
      ${metric(isPitcher ? "HR allowed in tracked feed" : "Home runs", homeRuns.length)}
      ${metric(isPitcher ? "Air outs induced" : "Air outs", airOuts)}
      ${metric(isPitcher ? "Sac flies allowed" : "Sac flies", sacFlies)}
      ${metric("Close calls", closeCalls)}
    </div>
    <div class="favorite-detail-definition"><strong>Close call rule</strong><span>A verified non-home-run airborne ball with an MLB-tracked distance of at least 350 feet. Missing distance is never estimated.</span></div>
    <section class="favorite-detail-events"><h3>Verified recent events</h3>${renderEventRows(uniqueRows([...rows, ...homeRuns]).sort((a, b) => String(b.endTime || b.date || "").localeCompare(String(a.endTime || a.date || ""))))}</section>`;

  if (typeof elements.detailDialog.showModal === "function") elements.detailDialog.showModal();
  else elements.detailDialog.setAttribute("open", "");
}

async function refreshFavorites() {
  favorites = await window.TSLAccount.listFavorites();
  renderFavorites();
}

async function renderMembership() {
  if (!elements.membership || !elements.membershipStatus || !elements.subscribe) return;
  elements.membership.classList.remove("active", "pending");
  elements.subscribe.hidden = true;
  elements.membershipStatus.textContent = "Checking your membership status…";
  try {
    const status = await window.TSLAccount.subscriptionStatus();
    if (!status.required) {
      elements.membership.classList.add("active");
      elements.membershipStatus.textContent = "Your account is active. Paid enforcement is wired in but not flipped on yet.";
      return;
    }
    if (status.active) {
      elements.membership.classList.add("active");
      const periodEnd = status.currentPeriodEnd ? new Date(status.currentPeriodEnd).toLocaleDateString() : "";
      elements.membershipStatus.textContent = status.cancelAtPeriodEnd && periodEnd
        ? `Active through ${periodEnd}. Your subscription is set to cancel after this period.`
        : "Active subscription. Premium MLB boards and tools are unlocked.";
      return;
    }
    elements.membership.classList.add("pending");
    elements.membershipStatus.textContent = "No active subscription yet. Start membership to unlock the premium MLB boards and tools.";
    elements.subscribe.hidden = false;
  } catch (error) {
    elements.membership.classList.add("pending");
    elements.membershipStatus.textContent = error.message || "Membership status is temporarily unavailable.";
  }
}

async function showSession(session) {
  const signedIn = Boolean(session?.user);
  elements.status.textContent = recoveryMode ? "Password recovery" : signedIn ? "Signed in" : "Signed out";
  elements.signedOut.hidden = signedIn && !recoveryMode;
  elements.signedIn.hidden = !signedIn || recoveryMode;
  if (recoveryMode) {
    showAuthView("new-password");
    setMessage("Recovery link verified. Choose a new password.");
    return;
  }
  if (!signedIn) return;
  if (redirectAfterAuth(session)) return;
  elements.emailDisplay.textContent = session.user.email || "Authenticated account";
  await renderMembership();
  try {
    if (!catalog.length) await loadCatalog();
    await refreshFavorites();
  } catch (error) {
    elements.list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

elements.signInTab.addEventListener("click", () => {
  showAuthView("signin");
  setMessage(signInPrompt());
});

elements.signUpTab.addEventListener("click", () => {
  showAuthView("signup");
  setMessage("Create a Slip Lab account. You may be asked to confirm your email before signing in.");
});

elements.showReset.addEventListener("click", () => {
  elements.resetEmail.value = elements.signInEmail.value.trim();
  showAuthView("reset");
  setMessage("Enter your account email to receive a secure recovery link.");
});

elements.cancelReset.addEventListener("click", () => {
  showAuthView("signin");
  setMessage(signInPrompt());
});

elements.signInForm.addEventListener("submit", async event => {
  event.preventDefault();
  const email = elements.signInEmail.value.trim();
  const password = elements.signInPassword.value;
  if (!email || !password) return;
  setButtonBusy(elements.signInForm, true, "Signing in…");
  setMessage("Signing in securely…");
  try {
    await window.TSLAccount.signInWithPassword(email, password);
    elements.signInForm.reset();
  } catch (error) {
    setMessage(authErrorMessage(error), true);
  } finally {
    setButtonBusy(elements.signInForm, false);
  }
});

elements.signUpForm.addEventListener("submit", async event => {
  event.preventDefault();
  const email = elements.signUpEmail.value.trim();
  const password = elements.signUpPassword.value;
  if (!email || !passwordsMatch(password, elements.signUpPasswordConfirm.value)) return;
  setButtonBusy(elements.signUpForm, true, "Creating account…");
  setMessage("Creating your private Slip Lab account…");
  try {
    const data = await window.TSLAccount.signUpWithPassword(email, password);
    elements.signUpForm.reset();
    if (data.session) {
      setMessage("Account created. You are signed in.");
    } else {
      showAuthView("signin");
      elements.signInEmail.value = email;
      setMessage(`Account created. Check ${email} to confirm the address, then sign in.`);
    }
  } catch (error) {
    setMessage(authErrorMessage(error), true);
  } finally {
    setButtonBusy(elements.signUpForm, false);
  }
});

elements.resetRequestForm.addEventListener("submit", async event => {
  event.preventDefault();
  const email = elements.resetEmail.value.trim();
  if (!email) return;
  setButtonBusy(elements.resetRequestForm, true, "Sending…");
  setMessage("Sending a secure password recovery link…");
  try {
    await window.TSLAccount.requestPasswordReset(email);
    setMessage(`If an account exists for ${email}, a recovery link has been sent.`);
  } catch (error) {
    setMessage(authErrorMessage(error), true);
  } finally {
    setButtonBusy(elements.resetRequestForm, false);
  }
});

elements.newPasswordForm.addEventListener("submit", async event => {
  event.preventDefault();
  const password = elements.newPassword.value;
  if (!passwordsMatch(password, elements.newPasswordConfirm.value)) return;
  setButtonBusy(elements.newPasswordForm, true, "Saving…");
  setMessage("Saving your new password…");
  try {
    await window.TSLAccount.updatePassword(password);
    recoveryMode = false;
    history.replaceState({}, document.title, "/account.html");
    elements.newPasswordForm.reset();
    setMessage("Password updated. Your account is ready.");
    await showSession(window.TSLAccount.session);
  } catch (error) {
    setMessage(authErrorMessage(error), true);
  } finally {
    setButtonBusy(elements.newPasswordForm, false);
  }
});

elements.signOut.addEventListener("click", async () => {
  elements.signOut.disabled = true;
  try { await window.TSLAccount.signOut(); }
  finally { elements.signOut.disabled = false; }
});

elements.subscribe?.addEventListener("click", async () => {
  elements.subscribe.disabled = true;
  elements.subscribe.textContent = "Opening checkout…";
  try {
    const checkout = await window.TSLAccount.createCheckoutSession();
    window.location.href = checkout.url;
  } catch (error) {
    setMessage(error.message || "Checkout is temporarily unavailable.", true);
    elements.subscribe.disabled = false;
    elements.subscribe.textContent = "Start membership";
  }
});

elements.search.addEventListener("input", renderSearchResults);

elements.results.addEventListener("click", async event => {
  const button = event.target.closest("[data-save-favorite]");
  if (!button) return;
  const [entityType, externalId] = button.dataset.saveFavorite.split(":");
  const item = catalog.find(candidate => candidate.entityType === entityType && String(candidate.externalId) === externalId);
  if (!item) return;
  button.disabled = true;
  try { await window.TSLAccount.addFavorite(item); await refreshFavorites(); }
  catch (error) { button.disabled = false; button.textContent = error.message; }
});

elements.list.addEventListener("click", async event => {
  const openButton = event.target.closest("[data-open-favorite]");
  if (openButton) {
    const favorite = favorites.find(item => String(item.id) === String(openButton.dataset.openFavorite));
    if (favorite) openFavoriteDetails(favorite);
    return;
  }
  const button = event.target.closest("[data-remove-favorite]");
  if (!button) return;
  button.disabled = true;
  try { await window.TSLAccount.removeFavorite(Number(button.dataset.removeFavorite)); await refreshFavorites(); }
  catch (error) { button.disabled = false; button.textContent = error.message; }
});

elements.dailyLabList.addEventListener("click", event => {
  const openButton = event.target.closest("[data-open-daily-favorite]");
  if (!openButton) return;
  const favorite = favorites.find(item => String(item.id) === String(openButton.dataset.openDailyFavorite));
  if (favorite) openFavoriteDetails(favorite);
});

elements.topSavedLook?.addEventListener("click", event => {
  const openButton = event.target.closest("[data-open-dashboard-favorite]");
  if (!openButton) return;
  const favorite = favorites.find(item => String(item.id) === String(openButton.dataset.openDashboardFavorite));
  if (favorite) openFavoriteDetails(favorite);
});

elements.detailClose.addEventListener("click", () => elements.detailDialog.close());
elements.detailDialog.addEventListener("click", event => {
  if (event.target === elements.detailDialog) elements.detailDialog.close();
});

window.addEventListener("tsl-account-ready", event => showSession(event.detail.session));
window.addEventListener("tsl-account-changed", event => showSession(event.detail.session));
window.addEventListener("tsl-account-recovery", event => {
  recoveryMode = true;
  showSession(event.detail.session);
});
window.addEventListener("tsl-account-error", event => {
  elements.status.textContent = "Unavailable";
  setMessage(event.detail.message, true);
});

if (redirectTarget()) setMessage("Sign in or create an account to continue to the member page you requested.");
if (window.TSLAccount) showSession(window.TSLAccount.session);
