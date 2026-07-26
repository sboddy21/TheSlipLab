import crypto from "node:crypto";

function firstAvailable(names) {
  return names.map(name => process.env[name]).find(Boolean) || "";
}

function supabaseConfig() {
  return {
    url: firstAvailable(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    serviceKey: firstAvailable(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"])
  };
}

function json(response, status, payload) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  return response.status(status).json(payload);
}

async function readRawBody(request) {
  if (typeof request.body === "string") return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString("utf8");
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const webhookSecret = firstAvailable(["STRIPE_WEBHOOK_SECRET"]);
  if (!webhookSecret) throw new Error("Stripe webhook secret is not configured");
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map(part => part.split("=")));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error("Missing Stripe signature");

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new Error("Invalid Stripe signature");
  }
}

function toIso(seconds) {
  return seconds ? new Date(Number(seconds) * 1000).toISOString() : null;
}

function normalizePlan(value) {
  const plan = String(value || "").trim().toLowerCase();
  if (plan === "yearly") return "annual";
  return ["weekly", "monthly", "annual"].includes(plan) ? plan : null;
}

async function stripeGet(path) {
  const secretKey = firstAvailable(["STRIPE_SECRET_KEY"]);
  if (!secretKey) throw new Error("Stripe secret key is not configured");
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, "")}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json"
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Stripe lookup failed");
  return payload;
}

async function subscriptionByCustomer(customerId) {
  if (!customerId) return null;
  const { url, serviceKey } = supabaseConfig();
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/user_subscriptions?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id&limit=1`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Accept: "application/json"
    }
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertSubscription(row) {
  if (!row.user_id) return;
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Subscription database is not configured");
  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/user_subscriptions?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      ...row,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error("Subscription database update failed");
}

async function rowFromSubscription(subscription) {
  let userId = subscription.metadata?.user_id || "";
  if (!userId) {
    const existing = await subscriptionByCustomer(subscription.customer);
    userId = existing?.user_id || "";
  }
  const firstItem = subscription.items?.data?.[0];
  return {
    user_id: userId,
    stripe_customer_id: subscription.customer || null,
    stripe_subscription_id: subscription.id || null,
    status: subscription.status || "inactive",
    price_id: firstItem?.price?.id || null,
    plan: normalizePlan(subscription.metadata?.plan),
    current_period_end: toIso(subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end)
  };
}

async function handleCheckoutCompleted(session) {
  if (!session.subscription) return;
  const subscription = await stripeGet(`subscriptions/${session.subscription}`);
  await upsertSubscription({
    ...(await rowFromSubscription(subscription)),
    user_id: subscription.metadata?.user_id || session.metadata?.user_id || session.client_reference_id,
    plan: normalizePlan(subscription.metadata?.plan || session.metadata?.plan)
  });
}

async function handleSubscriptionEvent(subscription) {
  await upsertSubscription(await rowFromSubscription(subscription));
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed" });
  }

  try {
    const rawBody = await readRawBody(request);
    verifyStripeSignature(rawBody, request.headers["stripe-signature"]);
    const event = JSON.parse(rawBody);

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await handleSubscriptionEvent(event.data.object);
    }

    return json(response, 200, { received: true });
  } catch (error) {
    return json(response, 400, { error: error.message || "Webhook failed" });
  }
}
