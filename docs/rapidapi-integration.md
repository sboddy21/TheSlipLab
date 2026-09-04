# Sportsbook API connection verification

Verified September 4, 2026 using the replacement credentials stored locally. The key is never copied into this report or browser assets.

Host: sportsbook-api2.p.rapidapi.com

Server-side client: scripts/providers/sportsbook-rapidapi.mjs. Reads RAPIDAPI_KEY and RAPIDAPI_HOST from process environment or local .env; restricts the destination host and rejects redirects. HTTP errors are reported without credential-bearing request details. It is now wired through scripts/odds/refresh.mjs into NCAAF and all-sport comparison catalogs; see sports-odds-integration.md for timestamp and quota limits.

## Observed coverage

- September 4–6: 48 MLB events, 88 NCAAF events, zero WNBA events.
- September 4–30: eight WNBA events; earliest returned start September 17, 23:30 UTC. This is feed coverage, not a claim that other games do not exist.
- The all-markets endpoint for Minnesota Twins at Chicago White Sox on September 4 returned game moneyline, spread and total markets, including first-five-innings markets. No player props were returned for that event.
- Provider's published markets page lists game/period moneylines, spreads, totals, soccer both-teams-to-score, and select futures. It does not list player props: https://sportsbookapi.com/markets/
- NCAAF single-market latest outcomes were successfully retrieved, including source-specific quote timestamps, decimal payouts, market keys, participant keys and live flags.

## Required normalization before public integration

The v1 competition/event bulk response observed here omits per-outcome timestamps. Its market lastFoundAt is not a substitute for an individual bookmaker quote timestamp. Retrieve timestamped latest outcomes before qualifying betting value. Reject live quotes, started events, mismatched teams or kickoff times, unsupported segments, malformed decimal prices and stale quotes. Preserve the original decimal payout for accounting; converting to rounded American display prices must not alter expected return or settlement.

A provider advantages/arbitrage response is not evidence validating The Slip Lab's model. No vendor advantage scores were promoted to high-confidence picks.

This connection does not supply verified MLB HR or WNBA player-prop prices. PropLine now supplies that separate integration, documented in propline-integration.md. College-football pregame prices now use RapidAPI; fail-closed model gates remain in place.

API reference: https://api.sportsbookapi.com/documentation/static/index.html
