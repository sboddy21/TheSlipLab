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
  search: document.getElementById("favoriteSearch"),
  results: document.getElementById("favoriteSearchResults"),
  list: document.getElementById("favoriteList"),
  summary: document.getElementById("favoritesSummary"),
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
  currentResults: {},
  previousResults: {},
  historyDays: []
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
  const [playerPool, matchups, playerCards, currentResults, previousResults, history] = await Promise.all([
    fetchOptionalJSON(`./data/mlb_player_pool.json?v=${version}`, { players: [] }),
    fetchOptionalJSON(`./data/game_pitcher_matchups.json?v=${version}`, { games: [] }),
    fetchOptionalJSON(`./data/player_card_data.json?v=${version}`, { players: [] }),
    fetchOptionalJSON(`./data/mlb_results.json?v=${version}`, { playerEvents: [], homeRuns: [] }),
    fetchOptionalJSON(`./data/mlb_results_previous.json?v=${version}`, { playerEvents: [], homeRuns: [] }),
    fetchOptionalJSON(`./data/hr_results_history.json?v=${version}`, { days: [] })
  ]);
  catalog = normalizeCatalog(playerPool, matchups);
  detailData = {
    playerCards: Array.isArray(playerCards.players) ? playerCards.players : [],
    currentResults,
    previousResults,
    historyDays: Array.isArray(history.days) ? history.days : []
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

function renderSearchResults() {
  const query = elements.search.value.trim().toLowerCase();
  if (query.length < 2) {
    elements.results.innerHTML = '<div class="empty-state">Enter at least two letters to search today’s live MLB pool.</div>';
    return;
  }
  const saved = new Set(favorites.map(favoriteKey));
  const matches = catalog.filter(item => [item.displayName, item.teamName].some(value => String(value || "").toLowerCase().includes(query))).slice(0, 12);
  elements.results.innerHTML = matches.length ? matches.map(item => {
    const disabled = saved.has(favoriteKey(item));
    return `<div class="favorite-option"><div><strong>${escapeHtml(item.displayName)}</strong><span>${escapeHtml(item.teamName)} · ${escapeHtml(item.context)}</span></div><button class="account-button secondary" type="button" data-save-favorite="${escapeHtml(item.entityType)}:${escapeHtml(item.externalId)}" ${disabled ? "disabled" : ""}>${disabled ? "Saved" : "Save"}</button></div>`;
  }).join("") : '<div class="empty-state">No current MLB player or probable pitcher matched that search.</div>';
}

function renderFavorites() {
  elements.summary.textContent = favorites.length === 1 ? "1 saved favorite" : `${favorites.length} saved favorites`;
  elements.list.innerHTML = favorites.length ? favorites.map(item => `<div class="favorite-card"><button class="favorite-card-open" type="button" data-open-favorite="${item.id}" aria-label="Open details for ${escapeHtml(item.display_name)}"><span class="favorite-card-type">${escapeHtml(item.sport)} ${escapeHtml(item.entity_type)}</span><strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.team_name || "Team unavailable")}</span><small>View verified game and event data →</small></button><button class="account-button danger" type="button" data-remove-favorite="${item.id}">Remove</button></div>`).join("") : '<div class="empty-state">No favorites saved yet. Search today’s player pool to build your board.</div>';
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
  elements.emailDisplay.textContent = session.user.email || "Authenticated account";
  try {
    if (!catalog.length) await loadCatalog();
    await refreshFavorites();
  } catch (error) {
    elements.list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

elements.signInTab.addEventListener("click", () => {
  showAuthView("signin");
  setMessage("Sign in with your email and password.");
});

elements.signUpTab.addEventListener("click", () => {
  showAuthView("signup");
  setMessage("Create a free account. You may be asked to confirm your email before signing in.");
});

elements.showReset.addEventListener("click", () => {
  elements.resetEmail.value = elements.signInEmail.value.trim();
  showAuthView("reset");
  setMessage("Enter your account email to receive a secure recovery link.");
});

elements.cancelReset.addEventListener("click", () => {
  showAuthView("signin");
  setMessage("Sign in with your email and password.");
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

if (window.TSLAccount) showSession(window.TSLAccount.session);
