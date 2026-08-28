import { authenticatedUser, json, serviceFetch } from "../lib/account-server.mjs";

async function rows(table, query) {
  const response = await serviceFetch(`/rest/v1/${table}?${query}`);
  if (!response.ok) throw new Error(`Unable to export ${table.replaceAll("_", " ")}`);
  return response.json();
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return json(response, 405, { error: "Method not allowed" });
  }
  try {
    const user = await authenticatedUser(request);
    if (!user?.id) return json(response, 401, { error: "Sign in to export your data" });
    const id = encodeURIComponent(user.id);
    const [profile, preferences, favorites, subscription, referralCode, referrals, supportRequests] = await Promise.all([
      rows("user_profiles", `user_id=eq.${id}&select=*`), rows("member_preferences", `user_id=eq.${id}&select=*`), rows("favorite_entities", `user_id=eq.${id}&select=*`),
      rows("user_subscriptions", `user_id=eq.${id}&select=status,plan,price_id,current_period_end,cancel_at_period_end,created_at,updated_at`),
      rows("referral_codes", `user_id=eq.${id}&select=code,created_at`),
      rows("referrals", `or=(referrer_user_id.eq.${id},referred_user_id.eq.${id})&select=status,created_at,converted_at`),
      rows("support_requests", `user_id=eq.${id}&select=id,category,message,status,created_at,updated_at`)
    ]);
    return json(response, 200, { exportedAt: new Date().toISOString(), account: { id: user.id, email: user.email, createdAt: user.created_at, lastSignInAt: user.last_sign_in_at, emailConfirmedAt: user.email_confirmed_at }, profile, preferences, favorites, subscription, referralCode, referrals, supportRequests });
  } catch (error) {
    return json(response, 500, { error: error.message || "Unable to export account data" });
  }
}
