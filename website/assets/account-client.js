const SUPABASE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.7/+esm";

let clientPromise;
let session = null;

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
  const emailRedirectTo = `${window.location.origin}/account.html`;
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo }
  });
  if (error) throw error;
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

async function signOut() {
  const client = await getClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

async function listFavorites() {
  if (!session?.user) return [];
  const client = await getClient();
  const { data, error } = await client
    .from("favorite_entities")
    .select("id,sport,entity_type,external_id,display_name,team_name,created_at")
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

window.TSLAccount = {
  get session() { return session; },
  getClient,
  signInWithPassword,
  signUpWithPassword,
  requestPasswordReset,
  updatePassword,
  signOut,
  listFavorites,
  addFavorite,
  removeFavorite,
  accessToken,
  subscriptionStatus,
  createCheckoutSession
};

window.TSLAccount.ready = initialize();
