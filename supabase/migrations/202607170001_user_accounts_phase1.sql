begin;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 60)
);

create table if not exists public.favorite_entities (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sport text not null,
  entity_type text not null,
  external_id text not null,
  display_name text not null,
  team_name text,
  created_at timestamptz not null default now(),
  constraint favorite_entities_sport check (sport in ('MLB', 'NBA', 'NFL', 'NHL')),
  constraint favorite_entities_type check (entity_type in ('player', 'pitcher')),
  constraint favorite_entities_external_id_length check (char_length(external_id) between 1 and 80),
  constraint favorite_entities_display_name_length check (char_length(display_name) between 1 and 120),
  unique (user_id, sport, entity_type, external_id)
);

create index if not exists favorite_entities_user_created_idx
  on public.favorite_entities (user_id, created_at desc);

alter table public.user_profiles enable row level security;
alter table public.favorite_entities enable row level security;

drop policy if exists "Users can read their own profile" on public.user_profiles;
create policy "Users can read their own profile"
  on public.user_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own profile" on public.user_profiles;
create policy "Users can update their own profile"
  on public.user_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own favorites" on public.favorite_entities;
create policy "Users can read their own favorites"
  on public.favorite_entities for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own favorites" on public.favorite_entities;
create policy "Users can add their own favorites"
  on public.favorite_entities for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own favorites" on public.favorite_entities;
create policy "Users can remove their own favorites"
  on public.favorite_entities for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, display_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

grant usage on schema public to authenticated;
grant select, update on public.user_profiles to authenticated;
grant select, insert, delete on public.favorite_entities to authenticated;
grant usage, select on sequence public.favorite_entities_id_seq to authenticated;

commit;
