-- Idempotencia de telemetría: event_id de cliente + INSERT ... ON CONFLICT DO NOTHING.
-- Compatible con filas existentes (event_id NULL: los NULL no entran en conflicto).
alter table public.telemetria_eventos
  add column if not exists event_id uuid;
alter table public.telemetria_eventos
  add column if not exists exit_timestamp timestamptz;
alter table public.telemetria_eventos
  add column if not exists previous_last_state text check (char_length(previous_last_state) <= 16);

create unique index if not exists ux_telemetria_usuario_evento
  on public.telemetria_eventos (usuario_id, event_id);

create or replace function public.registrar_eventos_telemetria(p_eventos jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_ins integer := 0;
  v_e jsonb;
  v_event_id uuid;
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
    -- event_id inválido o ausente => NULL (comportamiento legacy, sin conflicto).
    v_event_id := case
      when v_e->>'event_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (v_e->>'event_id')::uuid
      else null
    end;
    insert into public.telemetria_eventos (
      usuario_id, event_id, event_name, occurred_at, run_id, app_version, build_number,
      platform, os_version, app_state, screen, phase,
      pending_count_bucket, photo_size_bucket, sync_stage, error_category,
      native_exit_reason, previous_last_state, exit_timestamp, occurrence_count
    ) values (
      auth.uid(),
      v_event_id,
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
      nullif(left(coalesce(v_e->>'previous_last_state',''), 16), ''),
      nullif(v_e->>'exit_timestamp','')::timestamptz,
      least(greatest(coalesce((v_e->>'occurrence_count')::integer, 1), 1), 1000)
    )
    on conflict (usuario_id, event_id) do nothing;
    get diagnostics v_ins = row_count;
    v_n := v_n + v_ins;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.registrar_eventos_telemetria(jsonb) from public, anon;
grant execute on function public.registrar_eventos_telemetria(jsonb) to authenticated;
