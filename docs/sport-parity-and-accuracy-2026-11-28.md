# Sport parity and accuracy — November 28, 2026

## Feature comparison

The observed reference pages establish NBA research and NFL navigation, not complete specifications across all sports. Full feature parity is not established. SportsPredict exposes DFS lineup/strategy tools, survivor pools, sharp opportunities, opening-line movement, boosts and simulations; equivalent verified end-to-end flows have not been established here. Sweet Spot exposes sportsbook offers, measured hit rates against those exact offers, game selection and live research. Slip Lab NBA now displays matched priced offers and baseline form, but baseline form is not a sportsbook-line hit rate.

A feature is complete only after its provider input, player/game identity, calculation, empty/error state and browser interaction are verified. Source files and passing tests alone do not establish parity.

## Accuracy findings

| Sport | Current evidence | Limit |
| --- | --- | --- |
| NBA | Recovered 1,203 valid frozen pregame forecasts from exact player/game historical logs. MAE: points 4.6, rebounds 1.9, assists 1.3, threes 0.9. | Remaining older receipts require historical provider coverage. Live strategy and betting ROI remain unvalidated. |
| WNBA | 1,261 graded projections; reported MAE 4.5 / 1.9 / 1.3 / 0.9 for points/rebounds/assists/threes. | Audit of every receipt and priced strategy remains outstanding; offseason live coverage cannot be demonstrated today. |
| NCAAM | Historical fixed Elo validation: 3,517 selected games, 78.3% winner accuracy, 95% interval 76.9–79.6%; Brier 0.170 vs 0.211 baseline. | Historical winner evaluation does not validate current model variants, player props or betting profit. |
| NFL | Usage diagnostic: 2,656 samples, MAE 15.644, accepted season-mean baseline. | Not TD probability calibration; no validated priced out-of-sample TD strategy. |
| MLB | 24,735 settled verified receipts; 451 have recorded prices. Overall observed HR rate 7.69%, mean predicted probability 7.98%. For forecasts >=20%, observed rate 14.61% vs mean prediction 23.16%. | High-probability forecasts are overconfident in this archive. No settled priced ROI demonstrated. Offseason live coverage cannot be demonstrated today. |
| CFB | Existing prospective evaluation reports zero forward bets and does not qualify spread/total strategies. | Report is dated September 4 and needs reconciliation with current receipts; cannot certify current accuracy from it. |
| NHL | Current schedule/player research exists; zero eligible totals recommendations in audited board. | No out-of-sample totals calibration; goalie/lineup/defense verification remains incomplete. |

## Repairs in this audit

NBA settlement no longer depends exclusively on today's slate. Exact historical player/game matches can settle frozen pregame receipts after rollover. Missing rows remain pending, incomplete stats cannot silently become zeros, and capture timing is checked. The evidence audit now includes NCAAM and acknowledges existing but incomplete MLB archived price coverage.

## Unmet acceptance criteria

All-sport feature parity, independent source reconciliation of every active feed, complete prospective priced strategy validation, historical NBA backfill beyond available logs, CFB evaluation refresh and NHL calibration remain open. Statistical evidence cannot be manufactured by changing a passing flag. This report does not certify the site as 100% accurate.
