-- Receptor mínimo de telemetría técnica (NO aplicada remotamente en esta tarea).
-- Solo INSERT autenticado; cliente sin SELECT/UPDATE/DELETE; sin service_role.
create table if not exists public.telemetria_eventos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid(),
  received_at timestamptz not null default now(),
  event_name text not null check (event_name in (
    'app_start','app_background','app_foreground','form_edit',
    'draft_write_ok','draft_write_error',
    'photo_process_start','photo_process_ok','photo_process_error',
    'sync_start','sync_upload_start','sync_upload_ok','sync_upload_error','sync_end',
    'auth_change','logout','error_boundary','previous_run_unclean'
  )),
  occurred_at timestamptz,
  run_id text check (char_length(run_id) <= 64),
  app_version text check (char_length(app_version) <= 32),
  build_number text check (char_length(build_number) <= 32),
  platform text check (platform in ('android','ios','web')),
  os_version text check (char_length(os_version) <= 16),
  app_state text check (char_length(app_state) <= 16),
  screen text check (char_length(screen) <= 32),
  phase text check (char_length(phase) <= 32),
  pending_count_bucket text check (pending_count_bucket in ('0','1','2-5','6-20','>20')),
  photo_size_bucket text check (char_length(photo_size_bucket) <= 8),
  sync_stage text check (char_length(sync_stage) <= 32),
  error_category text check (char_length(error_category) <= 32),
  native_exit_reason text check (native_exit_reason in ('CRASH','CRASH_NATIVE','ANR','LOW_MEMORY','USER_REQUESTED','OTHER','UNSUPPORTED')),
  occurrence_count integer not null default 1 check (occurrence_count >= 1 and occurrence_count <= 1000)
);

alter table public.telemetria_eventos enable row level security;

drop policy if exists "telemetria insert propio" on public.telemetria_eventos;
create policy "telemetria insert propio"
  on public.telemetria_eventos for insert
  to authenticated
  with check (usuario_id = auth.uid());

-- Sin políticas de SELECT/UPDATE/DELETE para el cliente.
revoke select, update, delete on public.telemetria_eventos from authenticated, anon;

create or replace function public.registrar_eventos_telemetria(p_eventos jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_e jsonb;
begin
  if jsonb_typeof(p_eventos) != 'array' then
    raise exception 'batch inválido';
  end if;
  if jsonb_array_length(p_eventos) < 1 or jsonb_array_length(p_eventos) > 20 then
    raise exception 'batch debe tener entre 1 y 20 eventos';
  end if;
  for v_e in select * from jsonb_array_elements(p_eventos) loop
    if not (v_e->>'event_name' in (
      'app_start','app_background','app_foreground','form_edit',
      'draft_write_ok','draft_write_error',
      'photo_process_start','photo_process_ok','photo_process_error',
      'sync_start','sync_upload_start','sync_upload_ok','sync_upload_error','sync_end',
      'auth_change','logout','error_boundary','previous_run_unclean'
    )) then
      raise exception 'evento inválido';
    end if;
    insert into public.telemetria_eventos (
      usuario_id, event_name, occurred_at, run_id, app_version, build_number,
      platform, os_version, app_state, screen, phase,
      pending_count_bucket, photo_size_bucket, sync_stage, error_category,
      native_exit_reason, occurrence_count
    ) values (
      auth.uid(),
      left(coalesce(v_e->>'event_name',''), 32),
      nullif(v_e->>'occurred_at','')::timestamptz,
      left(coalesce(v_e->>'run_id',''), 64),
      left(coalesce(v_e->>'app_version',''), 32),
      left(coalesce(v_e->>'build_number',''), 32),
      case when v_e->>'platform' in ('android','ios','web') then v_e->>'platform' else 'android' end,
      left(coalesce(v_e->>'os_version',''), 16),
      left(coalesce(v_e->>'app_state','unknown'), 16),
      left(coalesce(v_e->>'screen',''), 32),
      left(coalesce(v_e->>'phase',''), 32),
      case when v_e->>'pending_count_bucket' in ('0','1','2-5','6-20','>20') then v_e->>'pending_count_bucket' else null end,
      left(coalesce(v_e->>'photo_size_bucket',''), 8),
      left(coalesce(v_e->>'sync_stage',''), 32),
      left(coalesce(v_e->>'error_category',''), 32),
      case when v_e->>'native_exit_reason' in ('CRASH','CRASH_NATIVE','ANR','LOW_MEMORY','USER_REQUESTED','OTHER','UNSUPPORTED') then v_e->>'native_exit_reason' else null end,
      least(greatest(coalesce((v_e->>'occurrence_count')::integer, 1), 1), 1000)
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.registrar_eventos_telemetria(jsonb) from public, anon;
grant execute on function public.registrar_eventos_telemetria(jsonb) to authenticated;
