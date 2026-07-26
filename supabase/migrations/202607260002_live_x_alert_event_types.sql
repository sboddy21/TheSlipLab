begin;

alter table public.x_live_events
  drop constraint if exists x_live_events_event_type;

alter table public.x_live_events
  add constraint x_live_events_event_type
  check (event_type in ('called_it_home_run', 'slip_lab_hit_home_run', 'live_ai_update'));

comment on constraint x_live_events_event_type on public.x_live_events is
  'Allowed server-only live X alert event types: called HRs, branded Slip Lab hits, and dry-run live AI updates.';

commit;
