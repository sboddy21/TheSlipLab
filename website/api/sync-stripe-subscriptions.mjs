const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const PLAN_ENV_KEYS = {
  weekly: ["STRIPE_PRICE_ID_WEEKLY", "TSL_STRIPE_PRICE_ID_WEEKLY"],
  monthly: ["STRIPE_PRICE_ID_MONTHLY", "TSL_STRIPE_PRICE_ID_MONTHLY", "STRIPE_PRICE_ID", "TSL_STRIPE_PRICE_ID"],
  annual: ["STRIPE_PRICE_ID_ANNUAL", "STRIPE_PRICE_ID_ANNUALLY", "TSL_STRIPE_PRICE_ID_ANNUAL", "TSL_STRIPE_PRICE_ID_ANNUALLY"]
};

function firstAvailable(names) {
  return names.map(name => process.env[name]).find(Boolean) || "";
}

function supabaseConfig() {
  return {
    url: firstAvailable(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    serviceKey: firstAvailable(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"])
  };
}

function adminSecret() {
  return firstAvailable(["TSL_ADMIN_SYNC_SECRET", "ADMIN_SYNC_SECRET", "CRON_SECRET"]);
}

function bearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || request.headers["x-tsl-admin-secret"] || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : String(header || "");
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

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function subscriptionPriority(subscription) {
  if (ACTIVE_STATUSES.has(subscription?.status)) return 5;
  if (subscription?.status === "past_due") return 4;
  if (subscription?.status === "incomplete") return 3;
  if (subscription?.status === "paused") return 2;
  if (subscription?.status === "unpaid") return 1;
  return 0;
}

async function supabaseFetch(path, options = {}) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Supabase service is not configured");
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

async function listSupabaseUsers() {
  const users = [];
  for (let page = 1; page <= 25; page += 1) {
    const response = await supabaseFetch(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    if (!response.ok) throw new Error("Unable to list Supabase users");
    const payload = await response.json();
    const batch = Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

function stripeQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach(item => query.append(key, item));
    } else if (value !== undefined && value !== null && value !== "") {
      query.append(key, value);
    }
  }
  return query.toString();
}

async function stripeGet(path, params = {}) {
  const secretKey = firstAvailable(["STRIPE_SECRET_KEY"]);
  if (!secretKey) throw new Error("Stripe secret key is not configured");
  const query = stripeQuery(params);
  const suffix = query ? `?${query}` : "";
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, "")}${suffix}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json"
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Stripe lookup failed");
  return payload;
}

async function listStripeSubscriptions() {
  const subscriptions = [];
  let startingAfter = "";
  for (let page = 0; page < 50; page += 1) {
    const payload = await stripeGet("subscriptions", {
      status: "all",
      limit: "100",
      starting_after: startingAfter,
      "expand[]": ["data.customer", "data.items.data.price"]
    });
    const batch = Array.isArray(payload?.data) ? payload.data : [];
    subscriptions.push(...batch);
    if (!payload?.has_more || !batch.length) break;
    startingAfter = batch[batch.length - 1].id;
  }
  return subscriptions;
}

function userIdForSubscription(subscription, usersById, usersByEmail) {
  const metadataUserId = subscription.metadata?.user_id || "";
  if (metadataUserId && usersById.has(metadataUserId)) return metadataUserId;

  const customer = subscription.customer;
  const customerEmail = typeof customer === "object" ? customer.email : "";
  const email = normalizedEmail(customerEmail || subscription.metadata?.email);
  return usersByEmail.get(email)?.id || "";
}

function rowFromSubscription(subscription, userId) {
  const customer = subscription.customer;
  const customerId = typeof customer === "object" ? customer.id : customer;
  const firstItem = subscription.items?.data?.[0];
  const priceId = firstItem?.price?.id || null;
  return {
    user_id: userId,
    stripe_customer_id: customerId || null,
    stripe_subscription_id: subscription.id || null,
    status: subscription.status || "inactive",
    price_id: priceId,
    plan: planFromPrice(priceId),
    current_period_end: toIso(subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end)
  };
}

async function upsertSubscriptions(rows) {
  if (!rows.length) return;
  const response = await supabaseFetch("/rest/v1/user_subscriptions?on_conflict=user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows.map(row => ({
      ...row,
      updated_at: new Date().toISOString()
    })))
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(details || "Unable to sync subscriptions into Supabase");
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    const configuredSecret = adminSecret();
    if (!configuredSecret) return json(response, 503, { error: "Admin sync secret is not configured" });
    if (bearerToken(request) !== configuredSecret) return json(response, 401, { error: "Unauthorized" });

    const users = await listSupabaseUsers();
    const usersById = new Map(users.map(user => [user.id, user]));
    const usersByEmail = new Map(
      users
        .map(user => [normalizedEmail(user.email), user])
        .filter(([email]) => Boolean(email))
    );

    const subscriptions = await listStripeSubscriptions();
    const bestByUserId = new Map();
    const skipped = [];

    subscriptions.forEach(subscription => {
      const userId = userIdForSubscription(subscription, usersById, usersByEmail);
      if (!userId) {
        const customer = subscription.customer;
        skipped.push({
          subscriptionId: subscription.id,
          customerId: typeof customer === "object" ? customer.id : customer || null,
          status: subscription.status || "unknown"
        });
        return;
      }

      const current = bestByUserId.get(userId);
      const better =
        !current ||
        subscriptionPriority(subscription) > subscriptionPriority(current.subscription) ||
        (
          subscriptionPriority(subscription) === subscriptionPriority(current.subscription) &&
          Number(subscription.created || 0) > Number(current.subscription.created || 0)
        );
      if (better) bestByUserId.set(userId, { subscription, row: rowFromSubscription(subscription, userId) });
    });

    const rows = Array.from(bestByUserId.values()).map(item => item.row);
    await upsertSubscriptions(rows);

    return json(response, 200, {
      ok: true,
      supabaseUsers: users.length,
      stripeSubscriptions: subscriptions.length,
      synced: rows.length,
      activeSynced: rows.filter(row => ACTIVE_STATUSES.has(row.status)).length,
      skipped: skipped.length,
      skippedSubscriptions: skipped.slice(0, 20)
    });
  } catch (error) {
    return json(response, 500, { error: error.message || "Subscription sync failed" });
  }
}
