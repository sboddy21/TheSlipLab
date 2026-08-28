begin;

alter table public.user_profiles
  add column if not exists timezone text not null default 'America/New_York',
  add column if not exists favorite_team text,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.user_profiles
  drop constraint if exists user_profiles_timezone_length;
alter table public.user_profiles
  add constraint user_profiles_timezone_length check (char_length(timezone) between 1 and 80);

alter table public.favorite_entities
  add column if not exists watchlist text not null default 'Main',
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.favorite_entities
  drop constraint if exists favorite_entities_watchlist_length;
alter table public.favorite_entities
  add constraint favorite_entities_watchlist_length check (char_length(watchlist) between 1 and 40);
alter table public.favorite_entities
  drop constraint if exists favorite_entities_notes_length;
alter table public.favorite_entities
  add constraint favorite_entities_notes_length check (notes is null or char_length(notes) <= 500);

create table if not exists public.member_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notify_lineups boolean not null default true,
  notify_scratches boolean not null default true,
  notify_model_moves boolean not null default true,
  notify_results boolean not null default true,
  email_frequency text not null default 'off',
  communication_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_preferences_email_frequency check (email_frequency in ('off', 'immediate', 'daily'))
);

create table if not exists public.support_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_requests_category check (category in ('account', 'billing', 'data', 'feedback', 'deletion', 'other')),
  constraint support_requests_message_length check (char_length(message) between 10 and 2000),
  constraint support_requests_status check (status in ('open', 'in_progress', 'resolved'))
);

create index if not exists support_requests_user_created_idx
  on public.support_requests (user_id, created_at desc);

create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  constraint referral_codes_format check (code ~ '^[A-Z0-9]{8,16}$')
);

create table if not exists public.referrals (
  id bigint generated always as identity primary key,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  referral_code text not null,
  status text not null default 'joined',
  created_at timestamptz not null default now(),
  converted_at timestamptz,
  constraint referrals_not_self check (referrer_user_id <> referred_user_id),
  constraint referrals_status check (status in ('joined', 'subscribed'))
);

create index if not exists referrals_referrer_created_idx
  on public.referrals (referrer_user_id, created_at desc);

insert into public.member_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

insert into public.referral_codes (user_id, code)
select id, upper(substr(replace(id::text, '-', ''), 1, 16))
from auth.users
on conflict (user_id) do nothing;

alter table public.user_profiles enable row level security;
alter table public.favorite_entities enable row level security;
alter table public.member_preferences enable row level security;
alter table public.support_requests enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;

drop policy if exists "Users can add their own profile" on public.user_profiles;
create policy "Users can add their own profile"
  on public.user_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own favorites" on public.favorite_entities;
create policy "Users can update their own favorites"
  on public.favorite_entities for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own preferences" on public.member_preferences;
create policy "Users can read their own preferences"
  on public.member_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can add their own preferences" on public.member_preferences;
create policy "Users can add their own preferences"
  on public.member_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own preferences" on public.member_preferences;
create policy "Users can update their own preferences"
  on public.member_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own support requests" on public.support_requests;
create policy "Users can read their own support requests"
  on public.support_requests for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can create their own support requests" on public.support_requests;
create policy "Users can create their own support requests"
  on public.support_requests for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own referral code" on public.referral_codes;
create policy "Users can read their own referral code"
  on public.referral_codes for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read referrals involving them" on public.referrals;
create policy "Users can read referrals involving them"
  on public.referrals for select to authenticated
  using ((select auth.uid()) = referrer_user_id or (select auth.uid()) = referred_user_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitted_code text;
  referring_user uuid;
begin
  insert into public.user_profiles (user_id, display_name, timezone)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'timezone'), ''), 'America/New_York')
  ) on conflict (user_id) do nothing;

  insert into public.member_preferences (user_id)
  values (new.id) on conflict (user_id) do nothing;

  insert into public.referral_codes (user_id, code)
  values (new.id, upper(substr(replace(new.id::text, '-', ''), 1, 16)))
  on conflict (user_id) do nothing;

  submitted_code := upper(trim(coalesce(new.raw_user_meta_data ->> 'referral_code', '')));
  if submitted_code <> '' then
    select user_id into referring_user
    from public.referral_codes
    where code = submitted_code
    limit 1;
    if referring_user is not null and referring_user <> new.id then
      insert into public.referrals (referrer_user_id, referred_user_id, referral_code)
      values (referring_user, new.id, submitted_code)
      on conflict (referred_user_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure private.handle_new_user();

grant usage on schema public to authenticated, service_role;
grant select, insert, update on public.user_profiles to authenticated;
grant select, insert, update, delete on public.favorite_entities to authenticated;
grant select, insert, update on public.member_preferences to authenticated;
grant select, insert on public.support_requests to authenticated;
grant select on public.referral_codes, public.referrals to authenticated;
grant usage, select on sequence public.favorite_entities_id_seq to authenticated;
grant usage, select on sequence public.support_requests_id_seq to authenticated;
grant usage, select on sequence public.referrals_id_seq to service_role;
grant all on public.member_preferences, public.support_requests, public.referral_codes, public.referrals to service_role;

commit;
