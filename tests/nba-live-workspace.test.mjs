import test from "node:test";
import assert from "node:assert/strict";
import { buildNbaWorkspace, normalizeNbaSchedule, parseNbaPlayerLog } from "../website/lib/nba-live.mjs";
const now = Date.parse("2026-10-24T16:00:00Z");
const team = (id, abbreviation, homeAway) => ({ homeAway, team: { id, abbreviation, displayName: abbreviation, name: abbreviation }, score: "0", leaders: [] });
const scoreboard = () => ({ leagues: [{ slug: "nba", season: { year: 2027, displayName: "2026-27" } }], events: [{ id: "100", date: "2026-10-24T23:00Z", status: { type: { state: "pre", shortDetail: "Scheduled" } }, competitions: [{ competitors: [team("1", "ATL", "home"), team("2", "BOS", "away")] }] }] });
const roster = id => ({ timestamp: "2026-10-24T15:59Z", team: { id }, season: { year: 2027 }, athletes: [{ id: `${id}01`, displayName: `Player ${id}`, position: { abbreviation: "G" } }] });
function fetcher({ injuryFailure = false, rosterFailure = false } = {}) {
  return async url => {
    if (url.includes("scoreboard")) return { ok: true, json: async () => scoreboard() };
    if (url.includes("injuries")) {
      if (injuryFailure) throw new Error("Injury timeout");
      return { ok: true, json: async () => ({ timestamp: "2026-10-24T15:59Z", injuries: [] }) };
    }
    const id = url.match(/teams\/(\d+)/)?.[1];
    if (rosterFailure && id === "1") throw new Error("Roster timeout");
    return { ok: true, json: async () => roster(id) };
  };
}

test("current NBA feed returns scheduled games and current-season roster identities", async () => {
  const data = await buildNbaWorkspace({ now, fetcher: fetcher() });
  assert.equal(data.games.length, 1);
  assert.equal(data.games[0].idProvider, "ESPN");
  assert.equal(data.players.length, 2);
  assert.equal(data.players[0].availability, "Unconfirmed");
  assert.equal(data.panels.schedule, "current");
});

test("injury or single roster failures do not blank the schedule", async () => {
  const injury = await buildNbaWorkspace({ now, fetcher: fetcher({ injuryFailure: true }) });
  assert.equal(injury.games.length, 1);
  assert.equal(injury.panels.injuries, "unavailable");
  const roster = await buildNbaWorkspace({ now, fetcher: fetcher({ rosterFailure: true }) });
  assert.equal(roster.games.length, 1);
  assert.equal(roster.players.length, 1);
  assert.equal(roster.panels.rosters, "partial");
});

test("wrong-date or malformed schedules cannot become a no-games slate", () => {
  const data = scoreboard();
  data.events[0].date = "2026-10-23T23:00Z";
  assert.throws(() => normalizeNbaSchedule(data, "2026-10-24"), /different slate/);
  assert.throws(() => normalizeNbaSchedule({}, "2026-10-24"), /incomplete/);
});

test("current-season logs use completed games and expose actual early-season sample size", () => {
  const payload = { filters: [{ name: "season", value: "2027" }], names: ["minutes", "points", "totalRebounds", "assists", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"], events: { "1": { gameDate: "2026-10-23T23:00Z", opponent: { abbreviation: "ATL" } }, "2": { gameDate: "2026-10-25T23:00Z" } }, seasonTypes: [{ displayName: "Regular Season", categories: [{ events: [{ eventId: "1", stats: ["30", "22", "8", "4", "3-7"] }, { eventId: "2", stats: ["35", "99", "9", "7", "9-12"] }] }] }] };
  const data = parseNbaPlayerLog(payload, 2027, now);
  assert.equal(data.gamesPlayed, 1);
  assert.equal(data.last5.games, 1);
  assert.equal(data.season.points, 22);
  assert.equal(data.recentGames[0].threes, 3);
  assert.throws(() => parseNbaPlayerLog(payload, 2026, now), /current season/);
});
