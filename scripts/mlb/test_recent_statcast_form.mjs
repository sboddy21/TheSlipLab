import assert from "node:assert/strict";
import { buildRecentForm } from "../statcast_zone_engine.js";

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

function row(daysAgo, exitVelocity, launchAngle, barrelClass, xwoba) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return {
    game_date: date.toISOString().slice(0, 10),
    launch_speed: String(exitVelocity),
    launch_angle: String(launchAngle),
    launch_speed_angle: String(barrelClass),
    estimated_woba_using_speedangle: String(xwoba),
    events: "field_out",
    zone: "5"
  };
}

const seasonBaseline = Array.from({ length: 60 }, (_, index) => row(45 + (index % 30), 88, 5, 2, 0.28));
const recentDamage = Array.from({ length: 30 }, (_, index) => row(index % 14, 99, 24, index < 12 ? 6 : 4, 0.54));
const strong = buildRecentForm([...seasonBaseline, ...recentDamage]);

assert.equal(strong.last15.battedBalls, 30);
assert.equal(strong.last15.reliability, 1);
assert(strong.trendIndex > 50);
assert(strong.modelAdjustment > 0 && strong.modelAdjustment <= 2.5);

const tiny = buildRecentForm([...seasonBaseline, row(1, 108, 25, 6, 0.8), row(2, 106, 24, 6, 0.75)]);
assert(tiny.reliability < 0.1);
assert(Math.abs(tiny.modelAdjustment) < 1);

const empty = buildRecentForm([]);
assert.equal(empty.status, "INSUFFICIENT_SAMPLE");
assert.equal(empty.modelAdjustment, 0);

console.log("Recent Statcast form tests passed");
