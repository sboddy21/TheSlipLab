import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "./index.js";

test("recently final games remain scannable for delayed MLB scoring", () => {
  const now = Date.parse("2026-07-30T01:30:00Z");
  assert.equal(__test.gameIsScannable({
    gameDate: "2026-07-29T23:10:00Z",
    status: { abstractGameState: "Final" }
  }, now), true);

  assert.equal(__test.gameIsScannable({
    gameDate: "2026-07-29T12:00:00Z",
    status: { abstractGameState: "Final" }
  }, now), false);
});

test("live games are always scannable", () => {
  assert.equal(__test.gameIsScannable({
    gameDate: "2026-07-29T23:10:00Z",
    status: { abstractGameState: "Live" }
  }), true);
});

test("a LIVE LONGSHOTS hitter matches by MLB player id", () => {
  const index = __test.buildAiIndex({
    sections: [{
      title: "LIVE LONGSHOTS",
      players: [{ playerId: 700932, name: "Kyle Manzardo", confidence: 0.64 }]
    }]
  }, ["LIVE LONGSHOTS"]);

  const match = __test.matchAi({
    playerId: 700932,
    player: "Kyle Manzardo"
  }, index);

  assert.equal(match.primary.section, "LIVE LONGSHOTS");
  assert.equal(match.primary.rank, 1);
});

test("a recent Manzardo home run is retained by the event lookback", () => {
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-07-30T01:20:00Z");

  try {
    const rows = __test.homeRunEvents({
      date: "2026-07-29",
      game: { gamePk: 824487 },
      maxAgeSeconds: 1800,
      feed: {
        gameData: {
          teams: {
            away: { name: "Cleveland Guardians" },
            home: { name: "Cincinnati Reds" }
          }
        },
        liveData: {
          boxscore: {
            teams: {
              away: { team: { name: "Cleveland Guardians" } },
              home: { team: { name: "Cincinnati Reds" } }
            }
          },
          plays: {
            allPlays: [{
              about: {
                atBatIndex: 58,
                endTime: "2026-07-30T01:19:11.550Z",
                halfInning: "top",
                inning: 8,
                isTopInning: true
              },
              result: {
                event: "Home Run",
                eventType: "home_run",
                description: "Kyle Manzardo homers (13)."
              },
              matchup: {
                batter: { id: 700932, fullName: "Kyle Manzardo" },
                pitcher: { id: 592332, fullName: "Brady Singer" }
              },
              playEvents: [{
                isPitch: true,
                hitData: {
                  totalDistance: 425,
                  launchSpeed: 104.1,
                  launchAngle: 31
                }
              }]
            }]
          }
        }
      }
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].playerId, 700932);
    assert.equal(rows[0].distance, 425);
  } finally {
    Date.now = realNow;
  }
});
