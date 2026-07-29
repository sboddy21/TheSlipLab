import crypto from "node:crypto";

export const config = {
  api: {
    bodyParser: false
  }
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
  const parts = String(signatureHeader || "").split(",").reduce((acc, part) => {
    const index = part.indexOf("=");
    if (index === -1) return acc;
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    if (!acc[key]) acc[key] = [];
    acc[key].push(value);
    return acc;
  }, {});
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) throw new Error("Missing Stripe signature");

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const valid = signatures.some(signature => {
    const signatureBuffer = Buffer.from(signature, "hex");
    return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  });
  if (!valid) throw new Error("Invalid Stripe signature");
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

function recoveryEmail(recoveryUrl) {
  return `<!doctype html>
  <html>
    <body style="margin:0;background:#f4f0e4;color:#071d36;font-family:Arial,Helvetica,sans-serif">
      <div style="display:none;max-height:0;overflow:hidden">Your Slip Lab access is one step away.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e4">
        <tr><td align="center" style="padding:36px 18px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf7;border:2px solid #071d36">
            <tr><td style="padding:34px">
              <div style="color:#d84320;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase">The Slip Lab</div>
              <h1 style="margin:18px 0 12px;font-size:40px;line-height:1;letter-spacing:-2px;text-transform:uppercase">You left something behind 👀</h1>
              <p style="margin:0 0 24px;color:#536375;font-size:17px;line-height:1.6">Your Slip Lab access is almost unlocked. Finish signing up to get the data behind the calls, complete player rankings, matchup insights, and more.</p>
              <a href="${recoveryUrl}" style="display:inline-block;padding:15px 20px;background:#d84320;color:#fff;font-size:12px;font-weight:900;letter-spacing:1px;text-decoration:none;text-transform:uppercase">Finish my sign-up</a>
              <p style="margin:28px 0 0;color:#7b8793;font-size:11px;line-height:1.5">If you no longer want to complete your membership, ignore this one-time reminder.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
}

async function sendRecoveryEmail(session) {
  const apiKey = firstAvailable(["RESEND_API_KEY"]);
  const email = session.customer_details?.email;
  const recoveryUrl = session.after_expiration?.recovery?.url;
  const optedIn = session.consent?.promotions === "opt_in";
  if (!apiKey || !email || !recoveryUrl || !optedIn) return;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `stripe-recovery-${session.id}`
    },
    body: JSON.stringify({
      from: "The Slip Lab <access@thesliplab.com>",
      to: [email],
      subject: "You left something behind 👀",
      html: recoveryEmail(recoveryUrl)
    })
  });

  if (!resendResponse.ok) {
    const details = await resendResponse.text();
    throw new Error(`Recovery email failed: ${details}`);
  }
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
    } else if (event.type === "checkout.session.expired") {
      await sendRecoveryEmail(event.data.object);
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
