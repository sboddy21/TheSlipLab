# Daily ratings and calibrated value evaluation

No reliable betting edge established. Historical calibration and retrospective returns do not qualify a market without sufficient independently recorded forward evidence.

Calibration was frozen at 2026-09-04T14:47:57.524Z, trained on 2024 walk-forward predictions only. Rating parameters were not retuned after the original 2025 results. The strategy requires an estimated return of at least 5% at the actual archived price; there is no guarantee the estimated return is accurate.

| Season | Predictions | Calibrated picks W–L–P | ROI | 95% whole-week bootstrap ROI |
|---|---:|---:|---:|---|
| 2025 | 812 | 138–140–0 | -2.19% | -14.43% to 8.23% |
| 2026 | 12 | 2–6–0 | -51.58% | -100.00% to 93.66% |

2025 is a reused diagnostic, and 2026 is a small newly evaluated retrospective sample. Neither is a substitute for a pregame recorded forward track record.

Qualification requires, per market, 200 settled prospective picks across eight weeks, a positive 95% weekly-bootstrap ROI lower bound, and positive returns in both halves. No market qualifies today. The live board computes this gate from its immutable versioned ledger, using only entries recorded after the calibration freeze and before kickoff.

Full probability scores, including Brier scores, log loss and calibration bins: website/data/cfb_daily_evaluation.json. Every prediction and simulated pick: website/data/cfb_daily_predictions.json.

- 2025 was already inspected; this rerun is diagnostic rather than a new holdout.
- 2026 early-season results are retrospective and too small for reliability claims.
- Archived closing quotes lack independently verified publication timestamps.
- Injury and roster adjustments are not available; weather is descriptive, not a model input.
- The combined strategy may have correlated picks; confidence intervals resample entire weeks.
