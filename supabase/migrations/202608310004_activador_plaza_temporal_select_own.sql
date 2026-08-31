begin;

drop policy if exists activador_plaza_temporal_select_own
  on public.activador_plaza_temporal;

create policy activador_plaza_temporal_select_own
  on public.activador_plaza_temporal
  for select
  to authenticated
  using (
    auth.uid() = activador_id
    and activo = true
    and cancelado_at is null
  );

commit;
