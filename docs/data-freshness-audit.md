# Data freshness repair — October 24, 2026

The local checkout's October 6 NBA snapshots do not establish production age.
GitHub refresh logs and current main-branch data were inspected separately.

## Verified production-source problems

- The Vercel ignore command skips sports refresh commits. An empty release commit
  runs only six times daily, allowing refreshed data to wait four hours to publish.
- NBA run 40103867481 succeeded while its scoreboard had
  `availability: schedule_unavailable` and `stale: true`. Downstream files converted
  that unavailable schedule into `no_games_scheduled` and zero players.
- MLB run 40075518776 failed with “Short-sample stabilization moved Drew Rasmussen
  away from the live baseline.” The validator did not account for the model's
  published 12–98 score clamp. Valid scores below the floor could stop publication.
- The NBA history builder requests the previous season in its ESPN fallback even
  during the current regular season. It also copies season averages into last-five
  and last-ten windows, making missing recent game logs appear available.

## Local repairs

- Sports refresh commits now pass the Vercel ignore command immediately. Social
  posting bookkeeping remains skippable. This requires releasing the changed rule.
- The shared JSON API rejects expired, future, missing, preserved, failed and
  wrong-slate source evidence. New output timestamps cannot hide old `dataAsOf`
  timestamps. NBA, WNBA and NFL derived boards also check their named source feeds.
- MLB arrays require a current successful health receipt with an artifact timestamp.
  No runtime filesystem timestamp is used to rejuvenate an old feed.
- The member-data client disables cached fetches and displays an explicit notice
  when the server cannot verify current data.
- NBA stale schedules abort before downstream builders run. Validation also checks
  upstream error and unavailable states.
- NBA summaries request the selected season. Recent windows remain null when logs
  are missing; those players cannot qualify for recommendations through the minutes
  engine.
- Both MLB validators check the stabilized score including its clamp.

## Audit and verification

`npm run data:audit` recursively evaluates JSON files and exits nonzero for any
unavailable current feed. It reports local files only; it must be run against a
production snapshot to describe production. Historical results, calibration,
explicit archives, monitor reports and park-reference files remain readable.

Freshness ceilings are 20 minutes for odds, two minutes for specified live feeds,
26 hours for historical baselines and one hour for other current outputs. These
are maximum ages, not promises of real-time delivery. Provider observation times
also do not establish exact bookmaker publication times.

Validation: 32 tests passed across data freshness, API GET/HEAD behavior, NBA
foundation, market checks, settlement and health publication/widget integrity.

## Remaining production verification

These changes have not been pushed or deployed. End-to-end delivery, scheduler
queue delay, source coverage, live-game latency and browser behavior across all
pages still require production verification. A freshness check protects against
known stale data; it does not establish provider superiority or prediction accuracy.
The unavailable NBA schedule still needs a successfully verified current source.
The official NBA schedule CDN request from this environment returned HTTP 403.
