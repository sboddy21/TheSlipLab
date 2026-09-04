# College football game lab

## Current system: daily v3

`website/cfb.html` uses `website/api/cfb-live.mjs` for live schedule and odds retrieval. A visible page polls every 60 seconds, refreshes on return to the tab, and offers a manual refresh button. The function coalesces simultaneous requests, holds an in-process cache for 30 seconds, and permits a 30-second CDN cache. An upstream failure returns 503, never an old response with a new timestamp. The page hides research signals immediately after a failed fetch or when retrieval age exceeds three minutes.

ESPN does not supply independently verified quote publication times. The UI timestamps retrieval, not the time the sportsbook changed the line. This is an ESPN-supplied book feed, not market-wide best-price discovery. Prices may be unavailable or delayed at source.

Live games are matched to static model snapshots by game and team IDs and neutral-site status. New/mismatched games have no projection. Ratings older than 36 hours, postponed/canceled games, missing prices and games at/after kickoff cannot generate research opportunities. New feed results replace old odds; missing odds are never carried forward. Search filters and expanded matchup details survive refreshes.

The GitHub workflow requests board/ledger refreshes every 15 minutes during August–January after deployment on the default branch. GitHub schedules can be delayed; client-side freshness gates remain authoritative. A normalized score-history cache in `data/cfb/live-history.json` avoids refetching two years of games each run. Each refresh reconciles the latest 14 days. Historical source corrections older than that window need a deliberate full history refresh.

## Ratings and calibration

`opponent-adjusted-daily-v3` fits points as scoring environment + offense(team) - defense(opponent) +/- home advantage/2. Opponent strengths are estimated jointly with weighted ridge regression. Neutral sites receive no field adjustment. Two years of games are available, with 240-day exponential half-life and ridge penalty 2, selected on 2024 for v2 and unchanged for v3. Both teams require four games in the latest 370 days.

Ratings freeze at 00:00 UTC each day. Only final games with kickoff more than 24 hours before the cutoff enter the fit. For future games, the cutoff cannot exceed today's midnight. The archive lacks reliable final-whistle timestamps, so the 24-hour exclusion is conservative. No target or later outcome enters its own prediction.

`daily-model.json` freezes the configuration, 2024-only logistic calibration and evaluation protocol. Spread and total probabilities are fitted using signed model-to-line differences from 2024 daily walk-forward predictions. The mapping may reveal weak or inverse association; no coefficient is retuned to make the 2025 or 2026 results look profitable. Calibrated probabilities are unproven estimates. They are compared with the actual offered price, and a research signal requires at least 5% estimated return. Missing prices never become assumed -110 odds. Moneylines remain descriptive; there are no moneyline picks.

Rosters and injuries are not covered by the model. Weather, where supplied by ESPN, is descriptive rather than a fitted feature. This limitation is visible on the page.

## Validation and the qualification gate

The original v2 report is retained in `cfb_backtest.json` and `docs/cfb-backtest-2025.md`. The v3 evaluation is `cfb_daily_evaluation.json`, with every prediction, archived line and simulated pick in `cfb_daily_predictions.json`; a readable report is `docs/cfb-daily-evaluation.md`.

2025 has already been inspected and is now labeled a reused historical diagnostic. The new 2026 early-season evaluation is retrospective, not a prospective track record. It was fetched/evaluated only after the new calibration was frozen. The 2025 calibrated simulation returned -2.19% across 278 picks; the early 2026 simulation lost 4.13 units across eight picks. Neither establishes a reliable edge.

Score forecasts are assessed by MAE/RMSE/bias and compared with the old baseline and closing lines on identical game sets. Probabilities are assessed with Brier scores, log loss and calibration bins. ROI confidence intervals resample entire weeks to preserve within-week dependence. Both winners and losers, exclusions and missing coverage remain in the downloads.

A market qualifies only after at least 200 settled pregame-recorded forward picks across eight weeks, a positive 95% weekly-bootstrap ROI lower bound, and positive returns in both halves. Historical simulated returns never qualify a market. These are screening requirements, not a guarantee or certification of future profitability. `edgeStatus` is recomputed from the versioned pregame ledger; only the current frozen configuration and qualifying provenance count. No market currently qualifies.

## Ledger and provenance

V1 and v2 records are preserved. V3 stores the first qualifying scheduled call per model/game/market, retaining its original price, line, probability, model/configuration hash and pregame timestamp. New records also include the training cutoff and odds retrieval timestamp. Records lacking full v3 provenance remain visible but cannot qualify a market. The headline record is version-specific. Canceled games are void; final scores settle calls; incomplete and postponed games remain pending. One unit is risked at the recorded American price, with pushes counted in the ROI denominator.

Live research comparisons can change every minute; they are not retroactively substituted for scheduled ledger calls. Historical simulations never write to the live ledger. Deployment is required for public API access and scheduled collection; the local preview alone does not activate GitHub schedules.

## Commands

- `npm run cfb:dev`: local static site plus the real live-data API on port 8765. A plain Python static server cannot serve the live endpoint.
- `npm run cfb:refresh`: refresh daily ratings, scheduled calls and results; requires the frozen model and history corpus.
- `npm run cfb:test`: temporal leakage, pricing, grading, freshness, failure and qualification tests.
- `npm run cfb:history`: original 2023–2025 results and 2024–2025 explicit closing markets. Raw cache: ignored `logs/cfb-history-cache`; normalized corpus: `data/cfb/history.json`.
- `npm run cfb:develop-daily`: creates the 2024-trained daily calibration manifest. Do not rerun to chase holdout profits; a changed version needs a newly reserved evaluation period.
- `npm run cfb:current-history`: fetch completed 2026 games only after a calibration manifest exists.
- `npm run cfb:backtest-daily`: reproduce the frozen 2025 diagnostic and 2026 retrospective test; no parameter selection.

Archived odds use explicit pregame closing fields from DraftKings (100), then ESPN BET (58); no live/open/current substitutions. Team IDs and signed spread pairs are checked. Quote publication/executability and historical score revisions cannot be independently verified. Artifacts retain configuration and input-data hashes for reproducibility.
