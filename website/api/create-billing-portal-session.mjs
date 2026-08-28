function firstAvailable(names) {
  return names.map(name => process.env[name]).find(Boolean) || "";
}

function supabaseConfig() {
  return {
    url: firstAvailable(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    serviceKey: firstAvailable(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"])
  };
}

function bearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function siteOrigin(request) {
  const configured = firstAvailable(["SITE_URL", "NEXT_PUBLIC_SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL"]);
  if (configured) return configured.startsWith("http") ? configured.replace(/\/+$/, "") : `https://${configured.replace(/\/+$/, "")}`;
  const proto = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function json(response, status, payload) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  return response.status(status).json(payload);
}

async function authenticatedUser(request) {
  const token = bearerToken(request);
  if (!token) return null;
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Subscription service is not configured");
  const userResponse = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!userResponse.ok) return null;
  return userResponse.json();
}

async function subscriptionCustomerId(userId) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Subscription service is not configured");
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id&limit=1`;
  const lookupResponse = await fetch(endpoint, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, Accept: "application/json" }
  });
  if (!lookupResponse.ok) throw new Error("Subscription lookup failed");
  const rows = await lookupResponse.json();
  return Array.isArray(rows) ? rows[0]?.stripe_customer_id || "" : "";
}

async function stripeRequest(path, options = {}) {
  const secretKey = firstAvailable(["STRIPE_SECRET_KEY"]);
  if (!secretKey) throw new Error("Stripe billing is not configured");
  return fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, "")}`, {
    ...options,
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", ...(options.headers || {}) }
  });
}

async function customerIdFromStripe(user) {
  if (!user?.email) return "";
  const params = new URLSearchParams({ email: user.email, limit: "10" });
  const customerResponse = await stripeRequest(`customers?${params.toString()}`);
  if (!customerResponse.ok) return "";
  const payload = await customerResponse.json();
  const customers = Array.isArray(payload?.data) ? payload.data : [];
  const exactMatches = customers.filter(customer => String(customer?.email || "").toLowerCase() === user.email.toLowerCase());
  for (const customer of exactMatches) {
    const subscriptionParams = new URLSearchParams({ customer: customer.id, status: "all", limit: "10" });
    const subscriptionResponse = await stripeRequest(`subscriptions?${subscriptionParams.toString()}`);
    if (!subscriptionResponse.ok) continue;
    const subscriptionPayload = await subscriptionResponse.json();
    const subscriptions = Array.isArray(subscriptionPayload?.data) ? subscriptionPayload.data : [];
    if (subscriptions.some(subscription => subscription?.metadata?.user_id === user.id)) return customer.id;
  }
  return exactMatches.sort((a, b) => Number(b.created || 0) - Number(a.created || 0))[0]?.id || "";
}

async function createPortalSession({ customerId, request }) {
  const body = new URLSearchParams({
    customer: customerId,
    return_url: `${siteOrigin(request)}/account.html?billing=return`
  });
  const portalResponse = await stripeRequest("billing_portal/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await portalResponse.json();
  if (!portalResponse.ok) throw new Error(payload?.error?.message || "Stripe billing portal is unavailable");
  return payload;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed" });
  }
  try {
    const user = await authenticatedUser(request);
    if (!user?.id) return json(response, 401, { error: "Sign in before managing your subscription" });
    const customerId = await subscriptionCustomerId(user.id) || await customerIdFromStripe(user);
    if (!customerId) return json(response, 404, { error: "No Stripe subscription was found for this account" });
    const portal = await createPortalSession({ customerId, request });
    if (!portal?.url) throw new Error("Stripe billing portal did not return a URL");
    return json(response, 200, { url: portal.url });
  } catch (error) {
    return json(response, 503, { error: error.message || "Billing portal unavailable" });
  }
}
