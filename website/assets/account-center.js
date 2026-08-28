const center = {
  root: document.getElementById("memberCenter"),
  state: document.getElementById("memberCenterState"),
  profileForm: document.getElementById("memberProfileForm"),
  displayName: document.getElementById("memberDisplayName"),
  email: document.getElementById("memberEmail"),
  timezone: document.getElementById("memberTimezone"),
  favoriteTeam: document.getElementById("memberFavoriteTeam"),
  profileMessage: document.getElementById("memberProfileMessage"),
  preferencesForm: document.getElementById("memberPreferencesForm"),
  notifyLineups: document.getElementById("notifyLineups"),
  notifyScratches: document.getElementById("notifyScratches"),
  notifyModelMoves: document.getElementById("notifyModelMoves"),
  notifyResults: document.getElementById("notifyResults"),
  emailFrequency: document.getElementById("memberEmailFrequency"),
  communicationConsent: document.getElementById("communicationConsent"),
  preferencesMessage: document.getElementById("memberPreferencesMessage"),
  watchlistFilter: document.getElementById("memberWatchlistFilter"),
  passwordForm: document.getElementById("memberPasswordForm"),
  newPassword: document.getElementById("memberNewPassword"),
  newPasswordConfirm: document.getElementById("memberNewPasswordConfirm"),
  passwordMessage: document.getElementById("memberPasswordMessage"),
  activity: document.getElementById("memberAccountActivity"),
  signOutOthers: document.getElementById("signOutOthersButton"),
  securityMessage: document.getElementById("memberSecurityMessage"),
  exportButton: document.getElementById("exportAccountButton"),
  deleteConfirmation: document.getElementById("deleteAccountConfirmation"),
  deleteButton: document.getElementById("deleteAccountButton"),
  privacyMessage: document.getElementById("memberPrivacyMessage"),
  supportForm: document.getElementById("memberSupportForm"),
  supportCategory: document.getElementById("memberSupportCategory"),
  supportMessage: document.getElementById("memberSupportMessage"),
  supportStatus: document.getElementById("memberSupportStatus"),
  referralLink: document.getElementById("memberReferralLink"),
  referralStats: document.getElementById("memberReferralStats"),
  referralMessage: document.getElementById("memberReferralMessage"),
  copyReferral: document.getElementById("copyReferralButton"),
  checklist: document.getElementById("memberOnboardingChecklist"),
  completeOnboarding: document.getElementById("completeOnboardingButton"),
  performance: document.getElementById("memberPerformance")
};

let profile = {};
let preferences = {};
let favorites = [];
let loaded = false;
let loading = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function message(element, value, error = false) {
  if (!element) return;
  element.textContent = value;
  element.classList.toggle("error", error);
}

function busy(button, state, label) {
  if (!button) return;
  if (state) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) button.textContent = button.dataset.originalLabel;
  }
}

function formatDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function selectTab(name) {
  document.querySelectorAll("[data-member-tab]").forEach(button => {
    const active = button.dataset.memberTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-member-panel]").forEach(panel => {
    const active = panel.dataset.memberPanel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function timezoneOptions(selected) {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const zones = [...new Set([localZone, selected, "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "UTC"].filter(Boolean))];
  center.timezone.innerHTML = zones.map(zone => `<option value="${zone}">${zone.replaceAll("_", " ")}</option>`).join("");
  center.timezone.value = selected || localZone;
}

function renderProfile(session) {
  center.displayName.value = profile.display_name || "";
  center.email.value = session?.user?.email || "";
  center.favoriteTeam.value = profile.favorite_team || "";
  timezoneOptions(profile.timezone);
}

function renderPreferences() {
  center.notifyLineups.checked = preferences.notify_lineups !== false;
  center.notifyScratches.checked = preferences.notify_scratches !== false;
  center.notifyModelMoves.checked = preferences.notify_model_moves !== false;
  center.notifyResults.checked = preferences.notify_results !== false;
  center.emailFrequency.value = preferences.email_frequency || "off";
  center.communicationConsent.checked = Boolean(preferences.communication_consent);
}

function renderActivity(session) {
  const user = session?.user || {};
  center.activity.innerHTML = `
    <div><dt>Account created</dt><dd>${formatDate(user.created_at || profile.created_at)}</dd></div>
    <div><dt>Last sign-in</dt><dd>${formatDate(user.last_sign_in_at)}</dd></div>
    <div><dt>Email verified</dt><dd>${user.email_confirmed_at ? formatDate(user.email_confirmed_at) : "Pending"}</dd></div>
    <div><dt>Current session</dt><dd>Active on this device</dd></div>`;
}

function renderWatchlists() {
  const selected = center.watchlistFilter.value || "all";
  const names = [...new Set(favorites.map(item => item.watchlist || "Main"))].sort();
  center.watchlistFilter.innerHTML = '<option value="all">All watchlists</option>' + names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  center.watchlistFilter.value = names.includes(selected) ? selected : "all";
  filterWatchlists();
}

function filterWatchlists() {
  const selected = center.watchlistFilter.value;
  document.querySelectorAll("[data-favorite-card]").forEach(card => {
    card.hidden = selected !== "all" && card.dataset.watchlist !== selected;
  });
}

function renderChecklist(session) {
  const checks = [
    ["Email verified", Boolean(session?.user?.email_confirmed_at)],
    ["Profile named", Boolean(profile.display_name)],
    ["Saved first player", favorites.length > 0],
    ["Alert preferences reviewed", Boolean(preferences.updated_at)],
    ["Setup marked complete", Boolean(profile.onboarding_completed_at)]
  ];
  center.checklist.innerHTML = checks.map(([label, done]) => `<div class="${done ? "done" : ""}"><b>${done ? "✓" : "•"}</b><span>${label}</span></div>`).join("");
  center.completeOnboarding.textContent = profile.onboarding_completed_at ? "Setup complete" : "Mark setup complete";
  center.completeOnboarding.disabled = Boolean(profile.onboarding_completed_at);
}

function normalizeName(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

async function renderPerformance() {
  if (!center.performance) return;
  const hitters = favorites.filter(item => item.sport === "MLB" && item.entity_type === "player");
  if (!hitters.length) {
    center.performance.innerHTML = '<div><strong>0</strong><span>Saved hitters</span></div><div><strong>0</strong><span>Verified HR</span></div><div><strong>0</strong><span>Close calls</span></div>';
    return;
  }
  try {
    const response = await fetch(`./data/hr_results_history.json?v=${Date.now()}`, { cache: "no-store" });
    const payload = response.ok ? await response.json() : { days: [] };
    const ids = new Set(hitters.map(item => String(item.external_id)));
    const names = new Set(hitters.map(item => normalizeName(item.display_name)));
    const matches = row => ids.has(String(row.playerId || "")) || names.has(normalizeName(row.player || row.batter));
    const days = Array.isArray(payload.days) ? payload.days : [];
    const homeRuns = days.flatMap(day => day.homeRuns || []).filter(matches);
    const events = days.flatMap(day => day.playerEvents || []).filter(matches);
    const closeCalls = events.filter(row => row.isCloseCall).length;
    center.performance.innerHTML = `<div><strong>${hitters.length}</strong><span>Saved hitters</span></div><div><strong>${homeRuns.length}</strong><span>Verified HR</span></div><div><strong>${closeCalls}</strong><span>Close calls</span></div>`;
  } catch {
    center.performance.innerHTML = '<div><strong>—</strong><span>Saved hitters</span></div><div><strong>—</strong><span>Verified HR</span></div><div><strong>—</strong><span>Close calls</span></div>';
  }
}

async function renderReferrals() {
  try {
    const summary = await window.TSLAccount.referralSummary();
    const joined = summary.referrals.length;
    const subscribed = summary.referrals.filter(item => item.status === "subscribed").length;
    center.referralLink.value = summary.code ? `${window.location.origin}/account.html?ref=${encodeURIComponent(summary.code)}` : "Referral link unavailable";
    center.referralStats.innerHTML = `<div><strong>${joined}</strong><span>Joined</span></div><div><strong>${subscribed}</strong><span>Subscribed</span></div><div><strong>${summary.code || "—"}</strong><span>Your code</span></div>`;
  } catch (error) {
    message(center.referralMessage, error.message, true);
  }
}

async function loadCenter(session) {
  if (!session?.user || !center.root || loaded || loading) return;
  loading = true;
  center.state.textContent = "Loading settings…";
  try {
    [profile, preferences, favorites] = await Promise.all([
      window.TSLAccount.getProfile(),
      window.TSLAccount.getPreferences(),
      window.TSLAccount.listFavorites()
    ]);
    window.TSLMemberPreferences = preferences;
    window.dispatchEvent(new CustomEvent("tsl:preferences-updated", { detail: preferences }));
    renderProfile(session);
    renderPreferences();
    renderActivity(session);
    renderWatchlists();
    renderChecklist(session);
    await Promise.all([renderPerformance(), renderReferrals()]);
    center.state.textContent = "Settings ready";
    loaded = true;
  } catch (error) {
    center.state.textContent = "Setup required";
    message(center.profileMessage, `${error.message}. The account-center database migration may still need to be applied.`, true);
  } finally {
    loading = false;
  }
}

document.querySelectorAll("[data-member-tab]").forEach(button => button.addEventListener("click", () => selectTab(button.dataset.memberTab)));
center.watchlistFilter?.addEventListener("change", filterWatchlists);

center.profileForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = center.profileForm.querySelector("button[type=submit]");
  busy(button, true, "Saving…");
  message(center.profileMessage, "Saving profile…");
  try {
    const currentEmail = window.TSLAccount.session?.user?.email || "";
    profile = await window.TSLAccount.saveProfile({ displayName: center.displayName.value, timezone: center.timezone.value, favoriteTeam: center.favoriteTeam.value });
    if (center.email.value.trim().toLowerCase() !== currentEmail.toLowerCase()) {
      await window.TSLAccount.updateEmail(center.email.value.trim());
      message(center.profileMessage, "Profile saved. Confirm the email-change links sent to your email addresses.");
    } else message(center.profileMessage, "Profile saved.");
    renderChecklist(window.TSLAccount.session);
  } catch (error) { message(center.profileMessage, error.message, true); }
  finally { busy(button, false); }
});

center.preferencesForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = center.preferencesForm.querySelector("button[type=submit]");
  if (center.emailFrequency.value !== "off" && !center.communicationConsent.checked) {
    message(center.preferencesMessage, "Turn on email consent or set email frequency to Off.", true);
    return;
  }
  busy(button, true, "Saving…");
  try {
    preferences = await window.TSLAccount.savePreferences({
      notifyLineups: center.notifyLineups.checked,
      notifyScratches: center.notifyScratches.checked,
      notifyModelMoves: center.notifyModelMoves.checked,
      notifyResults: center.notifyResults.checked,
      emailFrequency: center.emailFrequency.value,
      communicationConsent: center.communicationConsent.checked
    });
    window.TSLMemberPreferences = preferences;
    window.dispatchEvent(new CustomEvent("tsl:preferences-updated", { detail: preferences }));
    message(center.preferencesMessage, "Alert preferences saved.");
    renderChecklist(window.TSLAccount.session);
  } catch (error) { message(center.preferencesMessage, error.message, true); }
  finally { busy(button, false); }
});

center.passwordForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (center.newPassword.value !== center.newPasswordConfirm.value) return message(center.passwordMessage, "Passwords do not match.", true);
  const button = center.passwordForm.querySelector("button[type=submit]");
  busy(button, true, "Updating…");
  try {
    await window.TSLAccount.updatePassword(center.newPassword.value);
    center.passwordForm.reset();
    message(center.passwordMessage, "Password updated.");
  } catch (error) { message(center.passwordMessage, error.message, true); }
  finally { busy(button, false); }
});

center.signOutOthers?.addEventListener("click", async () => {
  busy(center.signOutOthers, true, "Signing out…");
  try { await window.TSLAccount.signOutOtherSessions(); message(center.securityMessage, "Other device sessions were signed out. Existing access tokens expire at their normal short timeout."); }
  catch (error) { message(center.securityMessage, error.message, true); }
  finally { busy(center.signOutOthers, false); }
});

center.completeOnboarding?.addEventListener("click", async () => {
  busy(center.completeOnboarding, true, "Saving…");
  try {
    profile = await window.TSLAccount.saveProfile({ displayName: center.displayName.value, timezone: center.timezone.value, favoriteTeam: center.favoriteTeam.value, onboardingCompleted: true });
    renderChecklist(window.TSLAccount.session);
  } catch (error) { center.state.textContent = error.message; busy(center.completeOnboarding, false); }
});

center.exportButton?.addEventListener("click", async () => {
  busy(center.exportButton, true, "Preparing…");
  try {
    const data = await window.TSLAccount.exportAccountData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `slip-lab-account-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) { message(center.privacyMessage, error.message, true); }
  finally { busy(center.exportButton, false); }
});

center.deleteButton?.addEventListener("click", async () => {
  if (center.deleteConfirmation.value !== "DELETE") return message(center.privacyMessage, "Type DELETE exactly to continue.", true);
  if (!window.confirm("Submit an account deletion request?")) return;
  busy(center.deleteButton, true, "Submitting…");
  try {
    const result = await window.TSLAccount.deleteAccount("DELETE");
    center.deleteConfirmation.value = "";
    message(center.privacyMessage, `Deletion request #${result.id} submitted. Your account remains available while the request is reviewed.`);
  } catch (error) { message(center.privacyMessage, error.message, true); }
  finally { busy(center.deleteButton, false); }
});

center.supportForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = center.supportForm.querySelector("button[type=submit]");
  busy(button, true, "Sending…");
  try {
    const result = await window.TSLAccount.sendSupportRequest(center.supportCategory.value, center.supportMessage.value.trim());
    center.supportForm.reset();
    message(center.supportStatus, `Request #${result.id} sent. We will reply to your account email.`);
  } catch (error) { message(center.supportStatus, error.message, true); }
  finally { busy(button, false); }
});

center.copyReferral?.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(center.referralLink.value); message(center.referralMessage, "Referral link copied."); }
  catch { center.referralLink.select(); message(center.referralMessage, "Link selected—copy it from the field."); }
});

window.addEventListener("tsl:favorites-updated", event => {
  favorites = Array.isArray(event.detail?.favorites) ? event.detail.favorites : [];
  renderWatchlists();
  renderChecklist(window.TSLAccount?.session);
  renderPerformance();
});

window.addEventListener("tsl-account-ready", event => loadCenter(event.detail.session));
window.addEventListener("tsl-account-changed", event => {
  if (event.detail.session?.user && !loaded) loadCenter(event.detail.session);
});

if (window.TSLAccount?.session?.user) loadCenter(window.TSLAccount.session);
