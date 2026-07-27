const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const PLAN_ENV_KEYS = {
  weekly: ["STRIPE_PRICE_ID_WEEKLY", "TSL_STRIPE_PRICE_ID_WEEKLY"],
  monthly: ["STRIPE_PRICE_ID_MONTHLY", "TSL_STRIPE_PRICE_ID_MONTHLY", "STRIPE_PRICE_ID", "TSL_STRIPE_PRICE_ID"],
  annual: ["STRIPE_PRICE_ID_ANNUAL", "STRIPE_PRICE_ID_ANNUALLY", "TSL_STRIPE_PRICE_ID_ANNUAL", "TSL_STRIPE_PRICE_ID_ANNUALLY"]
};

function firstAvailable(names) {
  return names.map(name => process.env[name]).find(Boolean) || "";
}

function paidAccessEnabled() {
  return String(firstAvailable(["TSL_PAID_ACCESS_ENABLED", "PAID_ACCESS_ENABLED"])).toLowerCase() === "true";
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

function json(response, status, payload) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  return response.status(status).json(payload);
}

function toIso(seconds) {
  return seconds ? new Date(Number(seconds) * 1000).toISOString() : null;
}

function planFromPrice(priceId) {
  for (const [plan, keys] of Object.entries(PLAN_ENV_KEYS)) {
    if (keys.some(key => process.env[key] && process.env[key] === priceId)) return plan;
  }
  return null;
}

async function authenticatedUser(request) {
  const token = bearerToken(request);
  if (!token) return null;

  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Subscription service is not configured");

  const userResponse = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!userResponse.ok) return null;
  return userResponse.json();
}

async function supabaseFetch(path, options = {}) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Subscription service is not configured");
  return fetch(`${url.replace(/\/+$/, "")}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
      ...(options.headers || {})
    }
  });
}

async function subscriptionForUser(userId) {
  const endpoint = `/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status,price_id,current_period_end,cancel_at_period_end,updated_at&limit=1`;
  const response = await supabaseFetch(endpoint);

  if (!response.ok) throw new Error("Subscription lookup failed");
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertSubscription(row) {
  if (!row.user_id) return;
  const response = await supabaseFetch("/rest/v1/user_subscriptions?on_conflict=user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      ...row,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error("Subscription repair failed");
}

async function stripeGet(path, params = {}) {
  const secretKey = firstAvailable(["STRIPE_SECRET_KEY"]);
  if (!secretKey) return null;
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, "")}${suffix}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json"
    }
  });
  if (!response.ok) return null;
  return response.json();
}

function subscriptionPriority(subscription) {
  if (ACTIVE_STATUSES.has(subscription?.status)) return 3;
  if (subscription?.status === "past_due") return 2;
  if (subscription?.status === "incomplete") return 1;
  return 0;
}

async function repairSubscriptionFromStripe(user) {
  if (!user?.email) return null;
  const customers = await stripeGet("customers", {
    email: user.email,
    limit: "10"
  });
  const customerRows = Array.isArray(customers?.data) ? customers.data : [];
  if (!customerRows.length) return null;

  const subscriptions = [];
  for (const customer of customerRows) {
    if (customer?.email && customer.email.toLowerCase() !== user.email.toLowerCase()) continue;
    const payload = await stripeGet("subscriptions", {
      customer: customer.id,
      status: "all",
      limit: "10",
      "expand[]": "data.items.data.price"
    });
    if (Array.isArray(payload?.data)) subscriptions.push(...payload.data);
  }

  const subscription = subscriptions
    .filter(item => item?.id)
    .sort((a, b) => subscriptionPriority(b) - subscriptionPriority(a) || Number(b.created || 0) - Number(a.created || 0))[0];

  if (!subscription) return null;
  const firstItem = subscription.items?.data?.[0];
  const priceId = firstItem?.price?.id || null;
  const row = {
    user_id: user.id,
    stripe_customer_id: subscription.customer || null,
    stripe_subscription_id: subscription.id,
    status: subscription.status || "inactive",
    price_id: priceId,
    plan: planFromPrice(priceId),
    current_period_end: toIso(subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end)
  };
  await upsertSubscription(row);
  return row;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    const required = paidAccessEnabled();
    if (!required) {
      return json(response, 200, {
        authenticated: true,
        required: false,
        active: true,
        status: "access_not_enforced"
      });
    }

    const user = await authenticatedUser(request);
    if (!user?.id) {
      return json(response, 401, {
        authenticated: false,
        required,
        active: false,
        status: "signed_out"
      });
    }

    let subscription = await subscriptionForUser(user.id);
    if (!subscription || !ACTIVE_STATUSES.has(subscription.status || "inactive")) {
      subscription = await repairSubscriptionFromStripe(user).catch(() => null) || subscription;
    }
    const status = subscription?.status || "inactive";
    return json(response, 200, {
      authenticated: true,
      required: true,
      active: ACTIVE_STATUSES.has(status),
      status,
      priceId: subscription?.price_id || null,
      currentPeriodEnd: subscription?.current_period_end || null,
      cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end)
    });
  } catch (error) {
    return json(response, 503, { error: error.message || "Subscription service unavailable" });
  }
}
