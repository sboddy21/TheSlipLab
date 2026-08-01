import fs from "node:fs/promises";
import path from "node:path";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const PUBLIC_FILES = new Set([
  "health_status.json",
  "hr_calibration_report.json",
  "hr_results_history.json",
  "mlb_ball_carry_index.json",
  "mlb_context_factors.json",
  "mlb_games_today.json",
  "mlb_park_factors.json",
  "mlb_park_shapes.json",
  "mlb_results.json",
  "mlb_results_previous.json",
  "mlb_weather.json"
]);

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
  response.setHeader("Vary", "Authorization");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  return response.status(status).json(payload);
}

function requestedFile(request) {
  const raw = Array.isArray(request.query?.file) ? request.query.file[0] : request.query?.file;
  const file = decodeURIComponent(String(raw || "")).replace(/^\/+/, "");
  if (!file || !/^[A-Za-z0-9_./-]+\.json$/.test(file)) return "";
  const normalized = path.posix.normalize(file);
  if (normalized !== file || normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

async function authenticatedUser(request) {
  const token = bearerToken(request);
  if (!token) return null;

  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Member data service is not configured");

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

async function activeSubscription(userId) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Member data service is not configured");
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status&limit=1`;
  const subscriptionResponse = await fetch(endpoint, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Accept: "application/json"
    }
  });

  if (!subscriptionResponse.ok) throw new Error("Subscription lookup failed");
  const rows = await subscriptionResponse.json();
  return ACTIVE_STATUSES.has(rows?.[0]?.status || "inactive");
}

async function authorize(request) {
  const user = await authenticatedUser(request);
  if (!user?.id) return { allowed: false, status: 401, reason: "signed_out" };
  if (!paidAccessEnabled()) return { allowed: true };
  if (!await activeSubscription(user.id)) {
    return { allowed: false, status: 403, reason: "subscription_required" };
  }
  return { allowed: true };
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    return json(response, 405, { error: "Method not allowed" });
  }

  const file = requestedFile(request);
  if (!file) return json(response, 400, { error: "Invalid data file" });

  try {
    if (!PUBLIC_FILES.has(file)) {
      const access = await authorize(request);
      if (!access.allowed) {
        return json(response, access.status, {
          error: access.reason,
          authenticated: access.status !== 401,
          active: false
        });
      }
    }

    const dataRoots = [
      path.resolve(process.cwd(), "website", "data"),
      path.resolve(process.cwd(), "data")
    ];
    let body = null;
    for (const dataRoot of dataRoots) {
      const filePath = path.resolve(dataRoot, file);
      if (filePath !== dataRoot && !filePath.startsWith(`${dataRoot}${path.sep}`)) continue;
      try {
        body = await fs.readFile(filePath, "utf8");
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    if (body === null) return json(response, 404, { error: "Data file not found" });
    JSON.parse(body);
    response.setHeader(
      "Cache-Control",
      PUBLIC_FILES.has(file) ? "public, max-age=0, must-revalidate" : "private, no-store, max-age=0"
    );
    if (!PUBLIC_FILES.has(file)) response.setHeader("Vary", "Authorization");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.method === "HEAD") return response.status(200).end();
    return response.status(200).send(body);
  } catch (error) {
    if (error?.code === "ENOENT") return json(response, 404, { error: "Data file not found" });
    return json(response, 503, { error: error.message || "Member data unavailable" });
  }
}
