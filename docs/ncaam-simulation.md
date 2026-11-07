# NCAAM Monte Carlo shadow model

Run `npm run ncaam:simulation:evaluate` to regenerate the fitted residual bank and holdout report. Run `npm run ncaam:simulation:shadow` after a successful `npm run ncaam:refresh` to compare on today's slate. The scheduled NCAAM refresh writes the latest comparison to `data/ncaam/simulation-shadow.json`. It records the slate timestamp, lines, 2,500-draw probabilities, and current picks at that observation. It is a rolling snapshot, not a forward results archive. Simulation failures do not block the published board. No member-facing picks or percentages read from the shadow file.

Each draw resamples a paired historical margin and total error and adds it to the current score projection. Keeping errors paired preserves the relationship observed in the training sample. The simulator converts the resulting margin and total to integer team scores, floors at zero, and resolves rounding ties with a random one-point winner; it does not simulate overtime possessions. The same set of final scores determines Moneyline, Spread, and Over/Under, including pushes. The seed is fixed per matchup and model version.

The errors come from 4,388 games in 2024–25. The 5,772-game holdout is the 2025–26 season. Each day's forecasts are computed before incorporating that day's results. Lower Brier scores are better:

| Market | Current | Simulation |
| --- | ---: | ---: |
| Moneyline | 0.19818 | 0.19397 |
| Spread | 0.23845 | 0.23888 |
| Over/Under | 0.24520 | 0.24540 |

The simulator improved Moneyline. It did not pass the gate requiring no degradation across all three markets. Spread and total were evaluated against synthetic lines near the model projections (including whole-point lines), so these figures do not establish sportsbook-line calibration or betting returns. See `data/ncaam/simulation-validation.json` for paired differences and approximate intervals.

Keep the simulator in shadow mode. Before changing the public probabilities, collect and grade pregame snapshots at verified sportsbook lines, then decide whether the result justifies switching.
