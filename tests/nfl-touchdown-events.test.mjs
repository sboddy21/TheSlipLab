import assert from "node:assert/strict";
import test from "node:test";
import { extractTouchdownEvents, parseTouchdownText } from "../scripts/nfl/touchdown_events.js";

test("parses receiving and rushing touchdown descriptions", () => {
  assert.deepEqual(parseTouchdownText("Joshua Palmer 43 Yd pass from Josh Allen (Tyler Bass Kick)", "Passing Touchdown"), { scorerName: "Joshua Palmer", passerName: "Josh Allen", yards: 43, kind: "receiving" });
  assert.deepEqual(parseTouchdownText("Josh Allen 1 Yd Rush (Tyler Bass Kick)", "Rushing Touchdown"), { scorerName: "Josh Allen", passerName: null, yards: 1, kind: "rushing" });
});

test("normalizes only touchdowns into durable event records", () => {
  const summary = { header: { competitions: [{ status: { type: { state: "post", detail: "Final", completed: true } } }] }, boxscore: { players: [{ team: { abbreviation: "BUF" }, statistics: [{ athletes: [{ athlete: { id: "1", displayName: "Josh Allen" } }, { athlete: { id: "2", displayName: "Joshua Palmer" } }] }] }] }, scoringPlays: [
    { id: "a", type: { text: "Passing Touchdown" }, scoringType: { name: "touchdown" }, text: "Joshua Palmer 43 Yd pass from Josh Allen (Tyler Bass Kick)", awayScore: 0, homeScore: 14, period: { number: 1 }, clock: { displayValue: "3:42" }, team: { abbreviation: "BUF" } },
    { id: "b", type: { text: "Field Goal Good" }, scoringType: { name: "fieldGoal" }, text: "Tyler Bass 31 Yd Field Goal", awayScore: 0, homeScore: 17, period: { number: 2 }, clock: { displayValue: "1:00" }, team: { abbreviation: "BUF" } }
  ] };
  const events = extractTouchdownEvents(summary, { gameId: "99", week: 2, kickoffUTC: "2026-09-17T00:00:00Z", venue: "Highmark Stadium", awayTeam: "DET", homeTeam: "BUF" });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventId, "99|a");
  assert.equal(events[0].scorerId, "2");
  assert.equal(events[0].passerId, "1");
  assert.equal(events[0].scoringLabel, "Receiving TD");
  assert.equal(events[0].opponent, "DET");
});

test("normalizes object-shaped schedule teams", () => {
  const summary = { header: { competitions: [{ status: { type: { state: "in", detail: "Q2", completed: false } } }] }, scoringPlays: [{ id: "a", type: { text: "Rushing Touchdown" }, scoringType: { name: "touchdown" }, text: "Josh Allen 1 Yd Rush", awayScore: 0, homeScore: 7, period: { number: 1 }, clock: { displayValue: "9:09" }, team: { abbreviation: "BUF" } }] };
  const [event] = extractTouchdownEvents(summary, { gameId: "99", week: 2, awayTeam: { abbreviation: "DET" }, homeTeam: { abbreviation: "BUF" } });
  assert.equal(event.awayTeam, "DET");
  assert.equal(event.homeTeam, "BUF");
  assert.equal(event.opponent, "DET");
});
