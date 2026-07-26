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

function safeReturnTo(value) {
  const target = String(value || "");
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("://")) return "/ai-says.html";
  return target;
}

function json(response, status, payload) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  return response.status(status).json(payload);
}

async function readJson(request) {
  if (request.body && typeof request.body === "object") return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

async function createStripeCheckoutSession({ user, request, returnTo }) {
  const secretKey = firstAvailable(["STRIPE_SECRET_KEY"]);
  const priceId = firstAvailable(["STRIPE_PRICE_ID", "TSL_STRIPE_PRICE_ID"]);
  if (!secretKey || !priceId) throw new Error("Stripe checkout is not configured yet");

  const origin = siteOrigin(request);
  const successReturn = encodeURIComponent(safeReturnTo(returnTo));
  const body = new URLSearchParams({
    mode: "subscription",
    client_reference_id: user.id,
    customer_email: user.email || "",
    success_url: `${origin}/account.html?checkout=success&redirect=${successReturn}`,
    cancel_url: `${origin}/account.html?checkout=cancelled&redirect=${successReturn}`,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[user_id]": user.id,
    "subscription_data[metadata][user_id]": user.id
  });

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await stripeResponse.json();
  if (!stripeResponse.ok) {
    throw new Error(payload?.error?.message || "Stripe checkout failed");
  }
  return payload;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    const user = await authenticatedUser(request);
    if (!user?.id) return json(response, 401, { error: "Sign in before subscribing" });
    const payload = await readJson(request).catch(() => ({}));
    const checkout = await createStripeCheckoutSession({
      user,
      request,
      returnTo: payload.returnTo
    });

    return json(response, 200, {
      id: checkout.id,
      url: checkout.url
    });
  } catch (error) {
    return json(response, 503, { error: error.message || "Checkout unavailable" });
  }
}
