begin;

alter table if exists public.activadores
  add column if not exists puede_activar boolean not null default false;

commit;
