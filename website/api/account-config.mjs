const PUBLIC_ENV_KEYS = {
  url: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
  key: [
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY"
  ]
};

function firstAvailable(names) {
  return names.map(name => process.env[name]).find(Boolean) || "";
}

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const url = firstAvailable(PUBLIC_ENV_KEYS.url);
  const publishableKey = firstAvailable(PUBLIC_ENV_KEYS.key);

  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!url || !publishableKey) {
    return response.status(503).json({
      error: "Account service is not configured"
    });
  }

  return response.status(200).json({ url, publishableKey });
}
