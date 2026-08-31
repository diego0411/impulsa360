begin;

alter table public.activador_plaza_temporal
  add column if not exists tipo_zona text not null default 'punto_temporal'
    check (tipo_zona in ('universidad', 'feria', 'evento', 'campana', 'punto_temporal')),
  add column if not exists ciudad_plaza text,
  add column if not exists activo boolean not null default true;

create index if not exists idx_activador_plaza_temporal_activa_vigente
  on public.activador_plaza_temporal(activador_id, activo, inicio, fin)
  where cancelado_at is null;

commit;
