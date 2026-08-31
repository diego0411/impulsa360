begin;

create or replace function public.validar_elegibilidad_reactivacion(
  p_ci text default null,
  p_telefono text default null,
  p_tipo_activacion text default null,
  p_fecha_referencia date default current_date,
  p_registro_id uuid default null
)
returns table (
  eligible boolean,
  reason text,
  previous_activation_date date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_tipo text := lower(coalesce(p_tipo_activacion, ''));
  v_ci text := upper(regexp_replace(coalesce(p_ci, ''), '[^0-9A-Za-z]', '', 'g'));
  v_telefono_digits text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_telefono text;
  v_fecha_referencia date := coalesce(p_fecha_referencia, current_date);
  v_limite date;
begin
  if v_usuario_id is null then
    raise exception using errcode = '42501', message = 'Sesión autenticada requerida.';
  end if;

  if not exists (
    select 1
    from public.activadores a
    where a.usuario_id = v_usuario_id
      and lower(btrim(coalesce(a.estado, ''))) = 'activo'
  ) then
    raise exception using errcode = '42501', message = 'Usuario inexistente o inactivo.';
  end if;

  if v_fecha_referencia < current_date - 1 or v_fecha_referencia > current_date + 1 then
    v_fecha_referencia := current_date;
  end if;
  v_limite := v_fecha_referencia - 90;

  if not (v_tipo like 'reactivacion%' or v_tipo = 'reimpresion_qr') then
    return query select true, null::text, null::date;
    return;
  end if;

  v_telefono := case
    when length(v_telefono_digits) > 8 then right(v_telefono_digits, 8)
    else v_telefono_digits
  end;

  if v_ci = '' and v_telefono = '' then
    return query select true, null::text, null::date;
    return;
  end if;

  return query
  with recientes as (
    select
      a.id,
      coalesce(a.fecha_activacion, a.created_at::date) as fecha,
      upper(regexp_replace(coalesce(a.ci_cliente, ''), '[^0-9A-Za-z]', '', 'g')) as ci_norm,
      case
        when length(regexp_replace(coalesce(a.telefono_cliente, ''), '\D', '', 'g')) > 8
          then right(regexp_replace(coalesce(a.telefono_cliente, ''), '\D', '', 'g'), 8)
        else regexp_replace(coalesce(a.telefono_cliente, ''), '\D', '', 'g')
      end as telefono_norm
    from public.activaciones a
    where (p_registro_id is null or a.id <> p_registro_id)
      and coalesce(a.fecha_activacion, a.created_at::date) > v_limite
      and coalesce(a.fecha_activacion, a.created_at::date) <= v_fecha_referencia
  ),
  coincidencia as (
    select r.fecha
    from recientes r
    where (v_ci <> '' and r.ci_norm = v_ci)
       or (v_telefono <> '' and r.telefono_norm = v_telefono)
    order by r.fecha desc
    limit 1
  )
  select
    (c.fecha is null) as eligible,
    case
      when c.fecha is null then null::text
      else 'periodo_minimo_no_cumplido'
    end as reason,
    c.fecha as previous_activation_date
  from (select null::date) base
  left join coincidencia c on true;
end;
$$;

revoke all on function public.validar_elegibilidad_reactivacion(text, text, text, date, uuid) from public, anon;
grant execute on function public.validar_elegibilidad_reactivacion(text, text, text, date, uuid) to authenticated;

commit;
