import { authenticatedUser, json, readJson, serviceFetch } from "../lib/account-server.mjs";

const CATEGORIES = new Set(["billing", "account", "data", "feedback", "deletion", "other"]);

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed" });
  }
  try {
    const user = await authenticatedUser(request);
    if (!user?.id) return json(response, 401, { error: "Sign in to contact support" });
    const body = await readJson(request);
    const category = String(body.category || "other").toLowerCase();
    const message = String(body.message || "").trim();
    if (!CATEGORIES.has(category)) return json(response, 400, { error: "Choose a valid support category" });
    if (message.length < 10 || message.length > 2000) return json(response, 400, { error: "Message must be between 10 and 2,000 characters" });
    const inserted = await serviceFetch("/rest/v1/support_requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ user_id: user.id, category, message })
    });
    if (!inserted.ok) throw new Error("Unable to save your support request");
    const [ticket] = await inserted.json();
    return json(response, 201, { id: ticket.id });
  } catch (error) {
    return json(response, 500, { error: error.message || "Unable to send support request" });
  }
}
