import assert from "node:assert/strict";
import {
  RESULT_EVENT_CATEGORIES,
  normalizeResultEventCategory
} from "./result_event_categories.mjs";

const category = (event, eventType, hasHitData = true) =>
  normalizeResultEventCategory({ event, eventType, hasHitData });

assert.equal(category("Groundout", "field_out"), "groundout");
assert.equal(category("Home Run", "home_run"), "home_run");
assert.equal(category("Double", "double"), "double");
assert.equal(category("Flyout", "field_out"), "flyout");
assert.equal(category("Forceout", "force_out"), "other_batted_ball");
assert.equal(category("Strikeout", "strikeout", false), "");

assert.ok(RESULT_EVENT_CATEGORIES.includes("groundout"));
assert.ok(RESULT_EVENT_CATEGORIES.includes("other_batted_ball"));
assert.ok(!RESULT_EVENT_CATEGORIES.includes("field_out"));

console.log("MLB result event category tests passed");
