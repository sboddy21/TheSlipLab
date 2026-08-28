export function firstAvailable(names) {
  return names.map(name => process.env[name]).find(Boolean) || "";
}

export function supabaseConfig() {
  return {
    url: firstAvailable(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]).replace(/\/+$/, ""),
    serviceKey: firstAvailable(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"])
  };
}

export function bearerToken(request) {
  const match = String(request.headers.authorization || request.headers.Authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

export function json(response, status, payload) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  return response.status(status).json(payload);
}

export async function readJson(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export async function authenticatedUser(request) {
  const token = bearerToken(request);
  const { url, serviceKey } = supabaseConfig();
  if (!token) return null;
  if (!url || !serviceKey) throw new Error("Account service is not configured");
  const result = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  return result.ok ? result.json() : null;
}

export async function serviceFetch(path, options = {}) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Account service is not configured");
  return fetch(`${url}${path}`, {
    ...options,
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, Accept: "application/json", ...(options.headers || {}) }
  });
}
