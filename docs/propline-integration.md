# PropLine integration

Verified locally September 4, 2026. Server-side credentials are PROPLINE_API_KEY and optional PROPLINE_BASE_URL=https://api.prop-line.com/v1. Authentication uses X-API-Key; secrets are not written into public files.

MLB's market builder now prefers PropLine when configured, retaining The Odds API when no PropLine key exists. The live run matched 16 games and 272 players, producing 678 book/player quotes from Fanatics, BetRivers and Pinnacle. These prices feed the decision center, public tags, AI board and timestamped prediction receipts. Binary Yes home-run markets represent one or more home runs and normalize to Over 0.5; alternate totals are excluded. Suspended, live, started, DFS and stale markets are excluded. Response event IDs and canonical player/game matches are checked.

WNBA's refresh now calls build_wnba_market_lines.mjs before its verified-market gate. It supports paired points, rebounds, assists and threes prices matched to canonical games and players. Live provider coverage was verified, but the current local canonical slate has no eligible pregame games and player baselines are stale. Therefore no WNBA picks are unlocked. Projection accuracy alone does not validate a priced betting strategy.

Provider last_update is an observation timestamp, not proof of when a bookmaker published the price. Preserve this distinction when evaluating the records. Historical odds have not been backfilled; these new live prices do not establish a profitable betting edge.

Local .env configuration does not configure production. Both refresh workflows now reference the GitHub Actions PROPLINE_API_KEY secret, which must be configured separately before scheduled production runs can use this provider. These changes have not been deployed.

API reference: https://prop-line.com/docs

The shared multi-sport catalog and card integrations supersede the initial HR-only connection. See sports-odds-integration.md for current refresh, quota, and display behavior.
