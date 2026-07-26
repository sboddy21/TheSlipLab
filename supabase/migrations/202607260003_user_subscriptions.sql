begin;

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive',
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_subscriptions_status
    check (status in ('inactive', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'))
);

create index if not exists user_subscriptions_status_idx
  on public.user_subscriptions (status, current_period_end desc);

alter table public.user_subscriptions enable row level security;

drop policy if exists "Users can read their own subscription" on public.user_subscriptions;
create policy "Users can read their own subscription"
  on public.user_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.user_subscriptions to authenticated;

commit;
