# College football: 2025 out-of-sample evaluation

Retrospective weekly walk-forward test. Settings selected on 2024 only, frozen for 2025. Each Monday 00:00 UTC fit uses final games kicked off at least 24 hours earlier. Earlier 2025 results enter later 2025 fits; target and later-week results never enter their own fit. No odds are model inputs.

Model: opponent-adjusted-ridge-v2. Config hash: 7c758e99fed71f5b9faac2f624581e2c400d5569671fc28b4f6759d18f2d206f.

## Coverage

814/957 final games projected; 143 skipped for insufficient history. Closing spreads: 811; totals: 806.

## Prediction accuracy

| Matched comparison | Adjusted model | Comparator |
|---|---:|---:|
| Margin MAE vs old baseline (814 games) | 12.62 | 14.50 |
| Total MAE vs old baseline | 13.02 | 13.07 |
| Margin MAE vs closing spread (811 games) | 12.61 | 11.82 |
| Total MAE vs closing total (806 games) | 13.05 | 12.59 |

Lower MAE is better. Model-minus-book margin MAE difference: 0.78; 95% weekly bootstrap interval: 0.46 to 1.09. Total: 0.45 (0.22 to 0.75).

## Closing-line simulation

| Strategy | W–L–P | Win rate | Net units | ROI |
|---|---:|---:|---:|---:|
| spread | 237–214–1 | 52.5% | 3.28 | 0.7% |
| total | 62–61–0 | 50.4% | -5.01 | -4.1% |
| combined | 299–275–1 | 52.1% | -1.73 | -0.3% |

One unit risked per qualifying pick at its archived American price, including pushes in the ROI denominator. Spread threshold: 4 points; total threshold: 6 points; unchanged from v1 and not optimized on either season. No default -110 prices.

## Source and limits

DraftKings (100), then ESPN BET (58); explicit close fields only. No live/current/open fallbacks. Closing quotes have no independently verified pregame timestamp.

- Retrospective closing quotes, not independently timestamped executable offers.
- Historical scores may include later corrections; not a point-in-time source archive.
- No roster, injury, weather or pace inputs.
- ATS Wilson intervals treat games as independent; MAE intervals resample entire weeks.
- Research simulation, not live ledger results. No guarantee of future performance.

Full predictions and excluded-game IDs: website/data/cfb_backtest_predictions.json. Per-week metrics, confidence intervals and coverage: website/data/cfb_backtest.json.
