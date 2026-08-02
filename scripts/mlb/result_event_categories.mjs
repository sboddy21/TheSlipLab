export const RESULT_EVENT_CATEGORIES = Object.freeze([
  "home_run",
  "double",
  "triple",
  "single",
  "sac_fly",
  "flyout",
  "lineout",
  "pop_out",
  "groundout",
  "other_batted_ball"
]);

export function normalizeResultEventCategory({ event, eventType, hasHitData = false }) {
  const eventName = String(event || "").trim().toLowerCase();
  const eventCode = String(eventType || "").trim().toLowerCase();

  if (eventName === "home run" || eventCode === "home_run" || eventName.includes("home run")) return "home_run";
  if (eventName === "double" || eventCode === "double") return "double";
  if (eventName === "triple" || eventCode === "triple") return "triple";
  if (eventName === "single" || eventCode === "single") return "single";
  if (eventName === "sac fly" || eventCode === "sac_fly") return "sac_fly";
  if (eventName.includes("flyout") || eventName.includes("fly out")) return "flyout";
  if (eventName.includes("lineout") || eventName.includes("line out")) return "lineout";
  if (eventName.includes("pop out") || eventName.includes("popout")) return "pop_out";
  if (
    eventName.includes("groundout") ||
    eventName.includes("ground out") ||
    eventCode === "groundout" ||
    eventCode === "ground_out" ||
    (eventCode === "field_out" && eventName.includes("ground"))
  ) return "groundout";

  return hasHitData ? "other_batted_ball" : "";
}
