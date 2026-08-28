const SUPABASE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.7/+esm";

let clientPromise;
let session = null;

const incomingReferral = new URLSearchParams(window.location.search).get("ref");
if (/^[A-Za-z0-9]{8,16}$/.test(String(incomingReferral || ""))) {
  localStorage.setItem("tsl_referral_code", incomingReferral.toUpperCase());
}

async function createAccountClient() {
  const response = await fetch("/api/account-config", {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Account service is temporarily unavailable");
  }

  const config = await response.json();
  if (!config.url || !config.publishableKey) {
    throw new Error("Account service is not configured");
  }

  const { createClient } = await import(SUPABASE_MODULE_URL);
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce"
    }
  });
}

function getClient() {
  if (!clientPromise) clientPromise = createAccountClient();
  return clientPromise;
}

function notify(type, detail = {}) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function updateAccountLinks(nextSession) {
  document.querySelectorAll("[data-tsl-account-link]").forEach(link => {
    link.textContent = nextSession?.user ? "My Account" : "Sign In";
    link.setAttribute("aria-label", nextSession?.user ? "Open your account" : "Sign in to The Slip Lab");
  });
}

async function initialize() {
  try {
    const client = await getClient();

    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession;
      updateAccountLinks(session);
      if (event === "PASSWORD_RECOVERY") {
        notify("tsl-account-recovery", { session });
        return;
      }
      notify("tsl-account-changed", { session });
    });

    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    updateAccountLinks(session);
    notify("tsl-account-ready", { session });
  } catch (error) {
    updateAccountLinks(null);
    notify("tsl-account-error", { message: error.message });
  }
}

async function signInWithPassword(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signUpWithPassword(email, password) {
  const client = await getClient();
  const requestedPlan = new URLSearchParams(window.location.search).get("plan");
  const planQuery = ["weekly", "monthly", "annual"].includes(requestedPlan)
    ? `?plan=${encodeURIComponent(requestedPlan)}`
    : "";
  const emailRedirectTo = `${window.location.origin}/account.html${planQuery}`;
  const referralCode = String(localStorage.getItem("tsl_referral_code") || "").trim().toUpperCase();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
        ...(referralCode ? { referral_code: referralCode } : {})
      }
    }
  });
  if (error) throw error;
  if (data?.user) localStorage.removeItem("tsl_referral_code");
  return data;
}

async function requestPasswordReset(email) {
  const client = await getClient();
  const redirectTo = `${window.location.origin}/account.html`;
  const { data, error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
  return data;
}

async function updatePassword(password) {
  const client = await getClient();
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

async function updateEmail(email) {
  const client = await getClient();
  const emailRedirectTo = `${window.location.origin}/account.html?email=confirmed`;
  const { data, error } = await client.auth.updateUser({ email }, { emailRedirectTo });
  if (error) throw error;
  return data;
}

async function signOut(scope = "local") {
  const client = await getClient();
  const { error } = await client.auth.signOut({ scope });
  if (error) throw error;
}

async function signOutOtherSessions() {
  const client = await getClient();
  const { error } = await client.auth.signOut({ scope: "others" });
  if (error) throw error;
}

async function getProfile() {
  if (!session?.user) throw new Error("Sign in to view your profile");
  const client = await getClient();
  const { data, error } = await client.from("user_profiles")
    .select("display_name,timezone,favorite_team,onboarding_completed_at,created_at,updated_at")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

async function saveProfile(profile) {
  if (!session?.user) throw new Error("Sign in to update your profile");
  const client = await getClient();
  const payload = {
    user_id: session.user.id,
    display_name: String(profile.displayName || "").trim() || null,
    timezone: String(profile.timezone || "America/New_York").trim(),
    favorite_team: String(profile.favoriteTeam || "").trim() || null,
    updated_at: new Date().toISOString()
  };
  if (profile.onboardingCompleted) payload.onboarding_completed_at = new Date().toISOString();
  const { data, error } = await client.from("user_profiles").upsert(payload, { onConflict: "user_id" }).select().single();
  if (error) throw error;
  return data;
}

async function getPreferences() {
  if (!session?.user) throw new Error("Sign in to view notification preferences");
  const client = await getClient();
  const { data, error } = await client.from("member_preferences")
    .select("notify_lineups,notify_scratches,notify_model_moves,notify_results,email_frequency,communication_consent,updated_at")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

async function savePreferences(preferences) {
  if (!session?.user) throw new Error("Sign in to update notification preferences");
  const client = await getClient();
  const payload = {
    user_id: session.user.id,
    notify_lineups: Boolean(preferences.notifyLineups),
    notify_scratches: Boolean(preferences.notifyScratches),
    notify_model_moves: Boolean(preferences.notifyModelMoves),
    notify_results: Boolean(preferences.notifyResults),
    email_frequency: ["off", "immediate", "daily"].includes(preferences.emailFrequency) ? preferences.emailFrequency : "off",
    communication_consent: Boolean(preferences.communicationConsent),
    updated_at: new Date().toISOString()
  };
  const { data, error } = await client.from("member_preferences").upsert(payload, { onConflict: "user_id" }).select().single();
  if (error) throw error;
  return data;
}

async function listFavorites() {
  if (!session?.user) return [];
  const client = await getClient();
  const { data, error } = await client
    .from("favorite_entities")
    .select("id,sport,entity_type,external_id,display_name,team_name,watchlist,notes,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function addFavorite(favorite) {
  if (!session?.user) throw new Error("Sign in before saving a favorite");
  const client = await getClient();
  const payload = {
    user_id: session.user.id,
    sport: favorite.sport,
    entity_type: favorite.entityType,
    external_id: String(favorite.externalId),
    display_name: favorite.displayName,
    team_name: favorite.teamName || null
  };
  const { data, error } = await client
    .from("favorite_entities")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeFavorite(id) {
  if (!session?.user) throw new Error("Sign in before changing favorites");
  const client = await getClient();
  const { error } = await client.from("favorite_entities").delete().eq("id", id);
  if (error) throw error;
}

async function updateFavorite(id, changes) {
  if (!session?.user) throw new Error("Sign in before changing favorites");
  const client = await getClient();
  const payload = {
    watchlist: String(changes.watchlist || "Main").trim().slice(0, 40) || "Main",
    notes: String(changes.notes || "").trim().slice(0, 500) || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await client.from("favorite_entities").update(payload).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

async function referralSummary() {
  if (!session?.user) throw new Error("Sign in to view referrals");
  const client = await getClient();
  const [{ data: codeRow, error: codeError }, { data: referrals, error: referralError }] = await Promise.all([
    client.from("referral_codes").select("code").eq("user_id", session.user.id).maybeSingle(),
    client.from("referrals").select("id,status,created_at,converted_at").eq("referrer_user_id", session.user.id).order("created_at", { ascending: false })
  ]);
  if (codeError) throw codeError;
  if (referralError) throw referralError;
  return { code: codeRow?.code || "", referrals: referrals || [] };
}

async function authenticatedApi(path, options = {}) {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to continue");
  const response = await fetch(path, {
    ...options,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Account request failed");
  return data;
}

async function sendSupportRequest(category, message) {
  return authenticatedApi("/api/account-support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, message })
  });
}

async function exportAccountData() {
  return authenticatedApi("/api/account-export");
}

async function deleteAccount(confirmation) {
  return authenticatedApi("/api/account-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation })
  });
}

async function accessToken() {
  const client = await getClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  session = data.session;
  return session?.access_token || "";
}

async function subscriptionStatus() {
  const token = await accessToken();
  if (!token) return { authenticated: false, required: false, active: false, status: "signed_out" };
  const response = await fetch("/api/subscription-status", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Unable to check subscription status");
  if (data.active) localStorage.removeItem("tsl_checkout_started");
  return data;
}

async function createCheckoutSession(plan = "monthly") {
  const token = await accessToken();
  if (!token) throw new Error("Sign in before subscribing");
  const response = await fetch("/api/create-checkout-session", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      plan,
      returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Unable to start checkout");
  if (!data.url) throw new Error("Checkout session did not return a Stripe URL");
  localStorage.setItem("tsl_checkout_started", String(Date.now()));
  return data;
}

async function createBillingPortalSession() {
  const token = await accessToken();
  if (!token) throw new Error("Sign in before managing your subscription");
  const response = await fetch("/api/create-billing-portal-session", {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Unable to open subscription management");
  if (!data.url) throw new Error("Billing portal did not return a Stripe URL");
  return data;
}

window.TSLAccount = {
  get session() { return session; },
  getClient,
  signInWithPassword,
  signUpWithPassword,
  requestPasswordReset,
  updatePassword,
  updateEmail,
  signOut,
  signOutOtherSessions,
  getProfile,
  saveProfile,
  getPreferences,
  savePreferences,
  listFavorites,
  addFavorite,
  removeFavorite,
  updateFavorite,
  referralSummary,
  sendSupportRequest,
  exportAccountData,
  deleteAccount,
  accessToken,
  subscriptionStatus,
  createCheckoutSession,
  createBillingPortalSession
};

window.TSLAccount.ready = initialize();
