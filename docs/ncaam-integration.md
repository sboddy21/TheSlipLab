# NCAAM Court Lab

Entry: `website/ncaam.html`, linked in shared navigation and the landing league bar.

Run `npm run ncaam:refresh` (optional YYYY-MM-DD argument) and `npm run ncaam:test`. The refresh uses ESPN's men’s college basketball scoreboard (`groups=50`, limit 1000), plus the configured RapidAPI sportsbook's **NCAAB** competition. Public branding and artifacts use NCAAM. No player-prop calls are made.

Outputs: `ncaam_board.json`, `odds_ncaam.json`, `ncaam_results.json` in `website/data`. Scoreboard failure exits without replacing the board. Provider failures are recorded; ESPN prices can keep the board available. The browser expires quotes after 20 minutes and at scheduled tipoff, and hides prices on refresh failure. The board uses existing membership fetch authorization and access gating.

Markets join only on exact normalized team names/known aliases and kickoff within five minutes. Provider event identifiers are canonicalized to ESPN IDs after the join, keeping comparisons scoped to the same matchup. ESPN prices carry market-observation timestamps, not claims about bookmaker publication time. Rankings, records and scoring/shooting averages are descriptive context; no adjusted-efficiency, pace, rest, prediction or profitable-edge claims are made.

Results retain the last successfully observed pregame quotes and grade each selection against confirmed final scores including overtime. They are neither verified closing lines nor model picks. New finals without a pregame observation cannot create retrospectively captured lines. Refreshes revisit up to seven unresolved game dates to settle prior slates. Results are an accumulating market archive; no fabricated historical record is seeded.

The `ncaam-refresh.yml` workflow refreshes every 15 minutes November–April, sharing the production data-writer concurrency group. It takes effect when these local changes are pushed to GitHub; no production deployment was performed during implementation.

Model picks and player props are intentionally unavailable pending college-specific validation and data coverage work.

## Validated winner forecasts

NCAAM now includes Elo v1 winner forecasts. See `docs/ncaam-model-validation.md` for methodology, test windows, acceptance criteria, reproducibility and limitations. The previous model-gated launch description above is superseded for straight-up winners only. Spread/total betting edges and player props remain unavailable. Additional output files are `ncaam_validation.json`, `ncaam_model.json`, and `ncaam_picks.json`; the workflow also persists `data/ncaam/current-history.json` so refreshes rebuild ratings without refetching the entire current season.
