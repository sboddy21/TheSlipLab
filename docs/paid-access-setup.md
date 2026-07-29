# Paid access setup

This phase adds the Stripe/Supabase subscription path while keeping enforcement behind a feature flag.

## 1. Supabase

Run the migration:

```sql
supabase/migrations/202607260003_user_subscriptions.sql
```

It creates `public.user_subscriptions` with RLS so authenticated users can read only their own subscription row. Server-side Vercel functions update the table with the Supabase service role key.

## 2. Vercel environment variables

Required for checkout and subscription verification:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `STRIPE_PRICE_ID_WEEKLY`
- `STRIPE_PRICE_ID_MONTHLY`
- `STRIPE_PRICE_ID_ANNUAL`
- `SITE_URL` set to `https://thesliplab.com`
- `TSL_ADMIN_SYNC_SECRET` set to a long private random value for admin-only Stripe → Supabase subscription backfills

`STRIPE_PRICE_ID` is still supported as a fallback for the monthly plan, but the three explicit plan variables are preferred.

Feature flag:

- `TSL_PAID_ACCESS_ENABLED=false` while setting up
- `TSL_PAID_ACCESS_ENABLED=true` when ready to require active subscriptions

## 3. Stripe

Create three recurring subscription prices in Stripe:

- Weekly → `STRIPE_PRICE_ID_WEEKLY`
- Monthly → `STRIPE_PRICE_ID_MONTHLY`
- Annual → `STRIPE_PRICE_ID_ANNUAL`

Add a webhook endpoint:

```text
https://thesliplab.com/api/stripe-webhook
```

Events to send:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## 4. Access behavior

When `TSL_PAID_ACCESS_ENABLED=false`, premium pages still require login only.

When `TSL_PAID_ACCESS_ENABLED=true`, premium pages require:

1. signed-in Supabase user
2. `user_subscriptions.status` of `active` or `trialing`

Logged-in users without an active subscription see a Stripe checkout button.

## 5. Backfill or repair subscriptions

If Stripe shows paid customers but `public.user_subscriptions` is missing rows, run the admin sync endpoint:

```bash
curl -X POST https://thesliplab.com/api/sync-stripe-subscriptions \
  -H "Authorization: Bearer $TSL_ADMIN_SYNC_SECRET"
```

The endpoint pulls all Stripe subscriptions, maps them to Supabase users by `metadata.user_id` first and Stripe customer email second, then upserts the latest/best subscription row for each user.
