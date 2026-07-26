begin;

alter table public.user_subscriptions
  add column if not exists plan text;

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_plan_check;

alter table public.user_subscriptions
  add constraint user_subscriptions_plan_check
  check (plan is null or plan in ('weekly', 'monthly', 'annual'));

commit;
