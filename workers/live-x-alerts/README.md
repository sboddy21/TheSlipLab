# The Slip Lab Live X Alerts Worker

This Cloudflare Worker is the near-live version of the “Slip Lab Called It” bot.

It is intentionally separate from the website refresh jobs. The Worker watches active MLB games, matches fresh home runs against the current AI Says board, records each event in Supabase, and only posts to X when the dedicated live toggle is enabled.

## What it posts

Version 1 is conservative:

- `TOP 5`
- `TOP 10`
- `ELITE SMASH`
- `LIVE LONGSHOTS`

It ignores older home runs by default. `MAX_EVENT_AGE_SECONDS=180` means the Worker only considers home runs from the last three minutes.

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
```

This is much closer to “when it happens” than a five-minute refresh, while staying inside Cloudflare Worker CPU limits.

## Required Supabase setup

Apply:

```text
supabase/migrations/202607250001_live_x_events.sql
```

The table has RLS enabled and no public policies. The Worker should use the Supabase service-role key from Cloudflare secrets.

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
