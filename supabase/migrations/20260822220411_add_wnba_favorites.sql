begin;

alter table public.favorite_entities
  drop constraint if exists favorite_entities_sport;

alter table public.favorite_entities
  add constraint favorite_entities_sport
  check (sport in ('MLB', 'WNBA', 'NBA', 'NFL', 'NHL'));

alter table public.favorite_entities
  drop constraint if exists favorite_entities_type;

alter table public.favorite_entities
  add constraint favorite_entities_type
  check (entity_type in ('player', 'pitcher', 'team'));

commit;
