# Sportsbook integration — September 4, 2026

## Implemented

`scripts/odds/refresh.mjs` writes a separate odds catalog for MLB, WNBA, NBA, NFL and NCAAF. RapidAPI supplies game moneylines, full-game spreads and totals. PropLine supplies supported player markets. Keys remain server-side in .env / deployment secrets. Public data contains prices, identity, provider, book and timestamps only.

The shared comparison panel supports searching by team or player and filtering game lines versus props. Player-card integrations cover the shared MLB card, WNBA decision-center dialog, NBA market dialogs, and NFL TD/receiving cards. Cards require a canonical game match, exact normalized player name, and MLB provider ID agreement where supplied. Doubleheader games remain separate. Unavailable, mismatched, started, suspended, DFS and stale quotes are excluded. Prices expire after 20 minutes in comparison displays; the existing MLB model-price gate remains 15 minutes.

NCAAF's live endpoint and model refresh now attach RapidAPI prices to ESPN game identities, with exact names/abbreviations and kickoff matching. Reference lines use a paired market from a deterministic book; each side may show a better price at that identical line from another book. Different spread/total lines are never treated as identical bets. Receipts preserve exact decimal payout, book, quote ID and timestamp. The `rapidapi-best-same-line-v1` market policy is assessed separately from older ESPN receipts; historical receipts are retained.

The older MLB card's heuristic HR percentage was removed. The card now displays realHrProbability from model data, or unavailable when absent. A signal score is not converted into a win probability.

## Timestamp and quota limits

RapidAPI's competition listing omits individual quote timestamps. Those prices are labeled market observations and are usable for comparison only. They cannot create calibrated NCAAF picks. The refresh verifies up to three individual markets for the nearest NCAAF game(s) per run. These carry individual quote timestamps and may pass existing model gates. This is limited verification coverage, not full-slate verified betting advice.

Five listings plus at most three individual-market requests every 15 minutes is at most 768 scheduled RapidAPI requests per day, before manual/other usage. A 429 stops detailed verification for the run. PropLine requests only events starting within 12 hours, reuses data fetched within five minutes, and stops event requests below a 50-request reserve. Crowded slates can exhaust usable free-tier coverage; missing prices stay unavailable. A larger allowance would be needed for broad individually verified game prices and continuous props across overlapping sports.

PropLine timestamps are provider observation times, not proof of bookmaker publication times. No timestamp is refreshed merely by rereading a cached price. MLB and WNBA model-price builders reuse the catalog so they do not duplicate event requests once catalog files exist.

## Verification and availability

Live checks returned MLB props in five categories (HR, hits, total bases, RBIs, strikeouts), NCAAF game lines and four prop categories (passing/rushing/receiving yards, anytime TD), and NFL game lines. WNBA/NBA returned no events in the seven-day window. That describes provider coverage, not a guarantee of league schedule completeness. NBA's malformed local schedule JSON was regenerated from its official scoreboard, which returned no games for September 4.

The NCAAF odds and book-comparison UI was checked in the mobile browser with no console errors. Protected MLB card UI verification is blocked by the existing local account service being unavailable; identity matching and rendered price-table output were tested separately. WNBA projections remain gated because current player baselines are stale and a priced strategy has not been validated. These changes do not establish a profitable betting edge for any sport.

## Refresh and production

`npm run odds:refresh` refreshes all catalogs. `npm run odds:test` checks normalization, identity, exact payouts, alternate lines, stale data and quota behavior.

The local `cfb:dev` server checks for an odds refresh every minute, refreshing when the last catalog is at least 14 minutes old. It serializes refreshes and leaves stale prices hidden after failures. Stop the dev server to stop local refreshes.

`.github/workflows/sports-odds-refresh.yml` schedules the production refresh every 15 minutes and references RAPIDAPI_KEY and PROPLINE_API_KEY repository secrets; the host is fixed to sportsbook-api2.p.rapidapi.com. These code/workflow changes are local and have not been deployed. Local .env does not configure GitHub or production secrets. Existing access controls remain in place.

Provider references: https://api.sportsbookapi.com/documentation/static/index.html and https://prop-line.com/docs
