import assert from "node:assert/strict";
import { buildIdentityLedger } from "./lib/identity_ledger.js";

const ledger = buildIdentityLedger({
  previousPool: { players: [{ playerId: 10, player: "Trade Test", teamId: 1, team: "Old Team" }, { playerId: 20, player: "Off Day", teamId: 3, team: "Same Team" }] },
  currentPlayers: [{ playerId: 10, player: "Trade Test", teamId: 2, team: "New Team" }, { playerId: 30, player: "Slate Arrival", teamId: 4, team: "Arrival Team" }],
  rejections: [{ playerId: 10, player: "Trade Test", rejectedTeamId: 1, rejectedTeam: "Old Team", canonicalTeamId: 2, canonicalTeam: "New Team", reason: "MLB_CURRENT_TEAM_MISMATCH" }],
  date: "2026-08-07",
  verifiedAt: "2026-08-07T22:00:00.000Z"
});

assert.equal(ledger.events.filter(event => event.type === "TEAM_CHANGE").length, 1);
assert.equal(ledger.events.filter(event => event.type === "STALE_OWNERSHIP_REJECTED").length, 1);
assert(!ledger.events.some(event => event.playerId === 20), "leaving a daily slate is not a transaction");
assert(!ledger.events.some(event => event.playerId === 30), "entering a daily slate is not a transaction");

const repeated = buildIdentityLedger({ previousLedger: ledger, previousPool: {}, currentPlayers: [], rejections: [], date: "2026-08-07", verifiedAt: "2026-08-07T22:15:00.000Z" });
assert.equal(repeated.eventCount, ledger.eventCount);
assert.equal(repeated.newEventCount, 0);

console.log("Identity ledger tests passed");
