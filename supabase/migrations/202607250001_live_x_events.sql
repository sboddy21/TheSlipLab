begin;

create table if not exists public.x_live_events (
  id bigint generated always as identity primary key,
  event_key text not null,
  date date not null,
  event_type text not null,
  player_id bigint,
  player_name text not null,
  game_pk bigint,
  play_id text,
  ai_section text,
  ai_rank integer,
  status text not null default 'dry_run',
  tweet_text text not null,
  x_post_id text,
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  constraint x_live_events_event_key_unique unique (event_key),
  constraint x_live_events_status check (status in ('dry_run', 'pending', 'posted', 'failed', 'skipped')),
  constraint x_live_events_event_type check (event_type in ('called_it_home_run')),
  constraint x_live_events_tweet_length check (char_length(tweet_text) between 1 and 280)
);

create index if not exists x_live_events_created_idx
  on public.x_live_events (created_at desc);

create index if not exists x_live_events_player_idx
  on public.x_live_events (player_id, created_at desc);

create index if not exists x_live_events_status_idx
  on public.x_live_events (status, created_at desc);

alter table public.x_live_events enable row level security;

revoke all on public.x_live_events from anon, authenticated;
revoke all on sequence public.x_live_events_id_seq from anon, authenticated;

comment on table public.x_live_events is
  'Server-only audit log for Cloudflare live X alerts. Accessed by service-role only; no public RLS policies.';

commit;
