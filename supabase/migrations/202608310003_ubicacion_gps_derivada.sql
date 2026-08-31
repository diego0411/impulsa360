begin;

alter table public.activaciones
  add column if not exists distrito_gps text,
  add column if not exists region_gps text;

commit;
