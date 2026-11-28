# Current sports data

Before answering a request for today's sports boards, model picks, prices or player research, run `npm run boards:read -- SPORT --json` (nba, nfl, nhl, cfb, ncaam, wnba or mlb). This fetches authoritative production main, reads one immutable commit and validates source freshness. `npm run boards:check` checks every sport.

Files in `website/data` are saved Git snapshots. Their presence does not establish that they are current, deployed or the live model's output. Never describe a local snapshot as current unless its source timestamps, slate date and dependencies have been verified. If the current-board reader fails, state which evidence is unavailable; do not silently substitute older snapshots or external analysis and call it the Slip Lab model.
