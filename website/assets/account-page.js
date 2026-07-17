const elements = {
  status: document.getElementById("accountStatus"),
  signedOut: document.getElementById("signedOutPanel"),
  signedIn: document.getElementById("signedInPanel"),
  form: document.getElementById("magicLinkForm"),
  email: document.getElementById("accountEmail"),
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function setMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle("error", isError);
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
  elements.status.textContent = signedIn ? "Signed in" : "Signed out";
  elements.signedOut.hidden = signedIn;
  elements.signedIn.hidden = !signedIn;
  if (!signedIn) return;
  elements.emailDisplay.textContent = session.user.email || "Authenticated account";
  try {
    if (!catalog.length) await loadCatalog();
    await refreshFavorites();
  } catch (error) {
    elements.list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  const email = elements.email.value.trim();
  if (!email) return;
  setMessage("Sending your secure sign-in link…");
  try {
    await window.TSLAccount.signInWithEmail(email);
    setMessage(`Check ${email} for your sign-in link. You can close this page after opening the email.`);
    elements.form.reset();
  } catch (error) {
    setMessage(error.message, true);
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
window.addEventListener("tsl-account-error", event => {
  elements.status.textContent = "Unavailable";
  setMessage(event.detail.message, true);
});

if (window.TSLAccount) showSession(window.TSLAccount.session);
