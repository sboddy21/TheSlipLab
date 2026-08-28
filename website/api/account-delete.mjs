import { authenticatedUser, json, readJson, serviceFetch } from "../lib/account-server.mjs";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed" });
  }
  try {
    const user = await authenticatedUser(request);
    if (!user?.id) return json(response, 401, { error: "Sign in to request account deletion" });
    const body = await readJson(request);
    if (body.confirmation !== "DELETE") return json(response, 400, { error: "Type DELETE exactly to confirm" });
    const inserted = await serviceFetch("/rest/v1/support_requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ user_id: user.id, category: "deletion", message: "Verified account deletion request submitted from Account Center." })
    });
    if (!inserted.ok) throw new Error("Unable to save your deletion request");
    const [ticket] = await inserted.json();
    return json(response, 202, { requested: true, id: ticket.id });
  } catch (error) {
    return json(response, 500, { error: error.message || "Unable to request account deletion" });
  }
}
