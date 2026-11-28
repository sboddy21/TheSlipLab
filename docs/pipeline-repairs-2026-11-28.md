# Sports pipeline repair verification — November 28, 2026

## Release and production checks

All seven sports refresh workflows and the sportsbook workflow completed successfully. Exact run URLs, commits and publication step outcomes are recorded in `pipeline-verification-2026-11-28.json`. Regression validation: 257 tests passed, zero failed. Member-facing pages were checked in the authenticated browser.

## Collection and matching

NHL collection now paginates the official source: 793 season skaters, with 576 matched players across all 26 teams on today's 13-game slate. The prior request silently stopped at 100 source records. Truncated, repeated and missing-identity pages now fail validation rather than producing an apparently complete board.

NBA sportsbook matching retains exact event time and home/away identity checks while resolving ESPN's nickname-only team names against canonical NBA cities. Provider lines and observed timestamps are preserved. No price or participation is invented when identity or evidence is missing.

## Refresh and publication

Every sports refresh checks schedule freshness, canonical game-ID uniqueness and persisted results structure before committing. Expired optional prices are stripped using the same preparation used by the member API, so they do not invalidate an otherwise current CFB schedule. A current, verified empty offseason slate is a successful collection, not an outage.

NCAAM now uses the shared retrying publisher, and its restricted checkout includes the publication check's dependencies. NBA sportsbook artifacts have one publishing owner. Overlapping MLB model/results writers share a serialization group. NBA, NHL and WNBA use bounded checkouts; WNBA avoids unrelated native package builds.

## Results tracking

NBA settlement matches frozen pregame receipts to exact historical game/player logs after the daily slate rolls over. The live results page displays 1,203 valid graded forecasts. Missing rows remain pending and incomplete stats are not substituted with zero.

NHL now saves pregame forecasts once, preserves them across dates, retrieves official final box scores, grades exact game/player matches, and exposes MAE and goal-probability Brier metrics in Results. Its pure settlement tests cover rollover, immutable forecasts, mismatched IDs, incomplete stats and non-final games. The real official final-box integration probe used a synthetic forecast and was excluded from performance figures. New real forecasts remain pending until their games finish.

Existing MLB, WNBA, NFL, CFB and NCAAM persisted result artifacts were checked by their successful publication contracts and regression suites. Structural validation and successful execution establish the tested data path; they do not certify every historic receipt or prediction accuracy.

## Browser observations

- MLB: a verified closed slate now renders promptly instead of waiting on optional research feeds.
- WNBA: today's zero-game slate is explicit, with completed projection metrics preserved.
- NBA: graded forecasts and market error metrics render on Results.
- NFL: current weekly games, player signals and game models load.
- NHL: expanded player coverage and the persistent results ledger render.
- CFB: 69 weekly games and 53 games with odds render.
- NCAAM: 76 games and 374 pregame prices render.

## Operational boundaries

Provider failures retain explicit unavailable/pending states. The checks cover current collection and delivery, tested identity/settlement rules and production publication; they do not promise uninterrupted third-party services, future prediction success, independently audited historic accuracy, or feature parity beyond this pipeline repair. Older NBA receipts outside currently available historical logs remain visibly pending rather than being reconstructed without evidence.
