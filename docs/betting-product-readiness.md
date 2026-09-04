# Betting product readiness audit — September 4, 2026

No sport currently has sufficient evidence to promise a reliable betting edge. Confidence in data quality, prediction accuracy, and expected betting return are separate claims.

## MLB

The audited archive contains 14,322 valid, settled pregame probability receipts. There are no archived sportsbook prices in those settled receipts, so historical ROI is not recoverable from this archive. A home-run outcome also does not establish participation or a bookmaker's void/settlement rules for every player.

Among 2,397 predictions at 20% or higher, the average estimate was 23.44% and the observed home-run rate was 14.18%. These rows share games and must not be treated as independent betting trials.

A chronological logistic recalibration was fit on 9,886 earlier receipts through August 18 and evaluated on 4,436 later receipts starting August 19. Brier score improved from 0.069861 to 0.067994 and log loss from 0.270005 to 0.248256. This is a diagnostic on an archive previously inspected in aggregate, not an untouched holdout or a profitable betting backtest. The frozen candidate is saved in scripts/mlb/hr-calibration-candidate.json and recorded in new receipts as shadowCalibration. It does not replace public probabilities.

Fixed a market-identity bug: the provider parser could overwrite a player's over-0.5-HR quote with an alternate over-2.5-HR quote and compare it with the probability of at least one HR. One quote in the saved September 1 snapshot had this mismatch. The parser, consumers, and refresh validator now require the explicit 0.5 threshold. Regression tests cover mixed alternate thresholds, missing lines, invalid odds and stale quotes. New prediction receipts capture matching timestamped prices when available; past prices are never invented or attached retrospectively.

## WNBA

The existing 138 graded projections measure MAE, not profitability. The release gate previously would have allowed MAE plus a raw projection-to-line difference to qualify recommendations, without a priced probability model or betting-performance validation. That automatic promotion is now disabled until the missing strategy implementation and independent validation exist.

The gate now matches game ID plus player ID plus market, uses the live projection snapshot, and rejects started games, missing prices, null lines, stale projections, stale underlying inputs and injury flags. Archived projections remain available for evaluation separately. Public pages now use the live snapshot and suppress stale player data. Removed a client-side bypass that generated “Best play” and “High confidence” from unpriced projections; role-support heuristics are displayed as scores out of 100, not winning probabilities. AI-analysis instructions prohibit inventing lines or presenting those scores as win probabilities.

The current ESPN baseline refresh received HTTP 403 from the teams endpoint. Its fallback baselines are dated August 4. Refresh validation now rejects stale source data even when generatedAt has been refreshed. No authorized WNBA player-prop feed is configured.

## NCAAF

The existing daily-model evaluation remains negative/inconclusive. The existing per-market prospective gate requires recorded pregame picks, actual prices, sufficient weeks and samples, and positive returns with uncertainty checks. Historical simulations do not substitute for that future record. No model retuning was performed on the already evaluated 2025/2026 outcomes during this audit.

## Remaining requirements

1. Configure access to current and timestamped historical prop prices; ODDS_API_KEY is absent from this workspace. MLB already has a provider adapter; WNBA still needs an authorized feed adapter and a calibrated priced strategy.
2. Restore a current WNBA baseline source. A timestamp on an old cache is insufficient.
3. Collect and settle independently recorded future predictions, retaining model versions, exact market thresholds, book prices, timing and void rules.
4. Evaluate each prespecified sport/market strategy after costs, with uncertainty clustered by time/game, and reserve untouched data before further model development. Do not tune repeatedly on a test period until it looks profitable.
5. Promote only supported strategies. If evidence is weak, abstain; a requirement to show picks every day is incompatible with evidence-based selection.

Reproduce the archive diagnostic with `node scripts/validation/audit-betting-evidence.mjs`. The detailed internal output is docs/betting-evidence-audit.json. Public pages have not had technical audit tables reintroduced.

## Verification

24 focused tests pass across NCAAF timing/settlement/qualification, MLB quote identity and receipt capture, and WNBA market and page safeguards. JavaScript and inline WNBA page scripts parse successfully. The local browser reaches the existing account gate for WNBA; full authenticated visual verification was not possible with this local server. Page behavior was checked with fixture-driven execution of the actual client script.

The final MLB full refresh passed validation with 420 current player profiles, 417 hitters and all 30 pitchers with Statcast zone coverage, and 419 new pregame receipts carrying the shadow candidate. Current prop prices remain unavailable because the local API key is absent. The calibration report also now deduplicates repeated player/game identities; 26 duplicate rows were excluded from the audited archive. Changes are local and have not been deployed.
