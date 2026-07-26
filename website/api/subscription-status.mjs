const ACTIVE_STATUSES = new Set(["active", "trialing"]);

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

async function subscriptionForUser(userId) {
  const { url, serviceKey } = supabaseConfig();
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status,price_id,current_period_end,cancel_at_period_end,updated_at&limit=1`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) throw new Error("Subscription lookup failed");
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
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

    const subscription = await subscriptionForUser(user.id);
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
