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
  summary: document.getElementById("favoritesSummary")
};

let catalog = [];
let favorites = [];
let recoveryMode = false;

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
  const [poolResponse, matchupResponse] = await Promise.all([
    fetch(`./data/mlb_player_pool.json?v=${version}`),
    fetch(`./data/game_pitcher_matchups.json?v=${version}`)
  ]);
  if (!poolResponse.ok || !matchupResponse.ok) throw new Error("Today's MLB player list is unavailable");
  catalog = normalizeCatalog(await poolResponse.json(), await matchupResponse.json());
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
  elements.list.innerHTML = favorites.length ? favorites.map(item => `<div class="favorite-card"><div><span class="favorite-card-type">${escapeHtml(item.sport)} ${escapeHtml(item.entity_type)}</span><strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.team_name || "Team unavailable")}</span></div><button class="account-button danger" type="button" data-remove-favorite="${item.id}">Remove</button></div>`).join("") : '<div class="empty-state">No favorites saved yet. Search today’s player pool to build your board.</div>';
  renderSearchResults();
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
  const button = event.target.closest("[data-remove-favorite]");
  if (!button) return;
  button.disabled = true;
  try { await window.TSLAccount.removeFavorite(Number(button.dataset.removeFavorite)); await refreshFavorites(); }
  catch (error) { button.disabled = false; button.textContent = error.message; }
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
