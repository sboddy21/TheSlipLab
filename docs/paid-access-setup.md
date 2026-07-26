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
- `STRIPE_PRICE_ID`
- `SITE_URL` set to `https://thesliplab.com`

Feature flag:

- `TSL_PAID_ACCESS_ENABLED=false` while setting up
- `TSL_PAID_ACCESS_ENABLED=true` when ready to require active subscriptions

## 3. Stripe

Create one recurring subscription price in Stripe, then use that price ID as `STRIPE_PRICE_ID`.

Add a webhook endpoint:

```text
https://thesliplab.com/api/stripe-webhook
```

Events to send:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## 4. Access behavior

When `TSL_PAID_ACCESS_ENABLED=false`, premium pages still require login only.

When `TSL_PAID_ACCESS_ENABLED=true`, premium pages require:

1. signed-in Supabase user
2. `user_subscriptions.status` of `active` or `trialing`

Logged-in users without an active subscription see a Stripe checkout button.
