# The Slip Lab Live X Alerts Worker

This Cloudflare Worker is the near-live version of the “Slip Lab Called It” bot.

It is intentionally separate from the website refresh jobs. The Worker watches active MLB games, matches fresh home runs against the current AI Says board, records each event in Supabase, and only posts to X when the dedicated live toggle is enabled.

## What it posts

Home-run posts are conservative:

- `TOP 5` and `TOP 10` home runs post as `slip_lab_hit_home_run` with the branded “SLIP LAB HIT” copy.
- `ELITE SMASH` and `LIVE LONGSHOTS` keep the existing called-it/longshot home-run path.

It ignores older home runs by default. `MAX_EVENT_AGE_SECONDS=180` means the Worker only considers home runs from the last three minutes.

`LIVE AI UPDATE` is intentionally dry-run only in this version. It stores a `live_ai_update` row in Supabase when:

- the player is already on the AI Says board
- the player has 2+ same-game hard-hit batted balls
- at least one hard-hit ball is 100+ mph EV
- the live contact bump moves confidence by at least `MIN_LIVE_AI_CONFIDENCE_MOVE`
- the player has not already received a live AI update in that game

## Runtime model

Cloudflare Cron wakes the Worker every minute. Each scheduled run performs one focused live-game scan:

```text
Cloudflare scheduled trigger
↓
scan active MLB live games
↓
match new HR plays against AI Says
↓
write dry-run or posted event to Supabase
↓
store dry-run Live AI Update candidates for review
```

This is much closer to “when it happens” than a five-minute refresh, while staying inside Cloudflare Worker CPU limits.

## Required Supabase setup

Apply:

```text
supabase/migrations/202607250001_live_x_events.sql
```

The table has RLS enabled and no public policies. The Worker should use the Supabase service-role key from Cloudflare secrets.

If the table already exists from the first version, also apply:

```text
supabase/migrations/202607260002_live_x_alert_event_types.sql
```

## Cloudflare secrets

Required for dry-run:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put ADMIN_TOKEN
```

Required only when real X posting is enabled:

```bash
wrangler secret put X_API_KEY
wrangler secret put X_API_SECRET
wrangler secret put X_ACCESS_TOKEN
wrangler secret put X_ACCESS_SECRET
```

## Safety toggle

The Worker will not post live unless this variable is true:

```toml
X_CALLED_IT_LIVE = "true"
```

The committed config leaves it off:

```toml
X_CALLED_IT_LIVE = "false"
```

In dry-run mode, matching events are inserted into Supabase with `status = 'dry_run'`.

Live AI updates always stay in dry-run mode in this version:

```toml
X_LIVE_AI_UPDATE_DRY_RUN = "true"
```

## Manual test

After deploying, call:

```bash
curl https://<worker-url>/health
```

To force one dry-run scan:

```bash
curl -X POST "https://<worker-url>/run?once=1" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

## Deploy

From this folder:

```bash
wrangler deploy
```

The Cron Trigger is configured in `wrangler.toml`:

```toml
[triggers]
crons = ["* * * * *"]
```
