# NCAAM Elo v1 validation

A college-specific straight-up winner forecaster, not a spread/total or betting-return model.

The fixed configuration was written before running the held-out test. Initial rating 1500, K 32, home advantage 65 Elo points (zero on neutral courts), logistic divisor 400, and 50% preseason retention. A forecast qualifies with at least eight historical games per team and a predicted winner probability of at least 60%. No hyperparameters were tuned after seeing holdout results.

ESPN public scoreboards were downloaded for all 313 dates in the two defined season windows, with retries and a fatal error if any date failed. All 12,592 unique confirmed finals with numeric, non-tied scores were retained. This includes Division I games against non-Division I opponents; no survivorship selection based on game outcomes was used. Source coverage is not independently certified complete.

Training: 6,292 games, November 4, 2024–April 8, 2025. Separate-season test: 6,300 games, November 3, 2025–April 8, 2026. Forecasts are generated before each game updates ratings. Ratings update sequentially during the test, as a live model would. The baseline is the training-season empirical home win rate (67.97%) for home venues and 50% at neutral venues.

Predeclared acceptance: at least 300 qualifying held-out forecasts; weighted 10-point-bin calibration error at most 10 percentage points; a positive lower nominal 95% bound on paired Brier improvement over baseline.

Result: **PASS**. 3,517 qualifying forecasts; 2,754 wins, 763 losses; 78.31% accuracy (nominal Wilson interval 76.91–79.64%). Brier 0.16981 versus baseline 0.21113. Paired Brier improvement 0.04132; lower nominal 95% bound 0.03657. Weighted calibration error 7.98 percentage points, generally underconfident. Shared teams create dependence; nominal intervals may overstate precision. The acceptance threshold is a launch criterion, not proof of perfect calibration.

No historical executable bookmaker prices were validated. No ROI, positive expected value, profitable spread or total predictions, or market-beating ability are established. Early-season forecasts carry roster/transfer uncertainty and explicitly disclose prior-season carryover.

Reproduction: `npm run ncaam:history`, then `npm run ncaam:validate`. The historical collector caches each date under `data/ncaam/scoreboards/`. `data/ncaam/history.json` holds the normalized finals; `data/ncaam/holdout-predictions.json` holds all pregame test forecasts. The validation receipt includes full config, dataset/config/state SHA-256 hashes, bins and limitations. `website/data/ncaam_model.json` contains the frozen rating state through the historical test.

Live refreshes verify artifact hashes, regress ratings into the current season, rebuild from confirmed current-season finals, and attach winner forecasts only when model integrity and historical validation pass. Failed source or model checks remain unavailable. The first forward pick publication is frozen before tipoff in `ncaam_picks.json`; later forecast movement cannot rewrite the recorded probability or selection. Confirmed finals grade that separate forward record. Historical test results are never presented as the forward record.
