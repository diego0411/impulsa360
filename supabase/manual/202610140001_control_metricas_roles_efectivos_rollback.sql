begin;

-- Reversión manual de 202610140001_control_metricas_roles_efectivos.
-- Fuente: definiciones de producción exportadas antes de la aplicación.
-- Restaura exclusivamente las dos RPC de métricas y sus ACL.

-- control_activaciones_detalle(p_activador_id uuid, p_equipo_id uuid, p_desde date, p_hasta date)
-- retorno: TABLE(id uuid, usuario_id uuid, fecha_activacion date, created_at timestamp with time zone, tipo_activacion text, nombres_cliente text, apellidos_cliente text, plaza text, foto_url text, foto_cash_in text, equipo_id_registro uuid, lider_id_registro uuid)
-- security_definer: true
-- config: ["search_path=\"\""]
CREATE OR REPLACE FUNCTION public.control_activaciones_detalle(p_activador_id uuid, p_equipo_id uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, usuario_id uuid, fecha_activacion date, created_at timestamp with time zone, tipo_activacion text, nombres_cliente text, apellidos_cliente text, plaza text, foto_url text, foto_cash_in text, equipo_id_registro uuid, lider_id_registro uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usuario_id uuid := auth.uid();
  v_rol text;
  v_estado text;
  v_es_admin boolean;
  v_es_lider boolean;
  v_lider_equipo_id uuid;
  v_equipo_actual_id uuid;
  v_activador_tiene_historial boolean;
begin
  if v_usuario_id is null then
    raise exception using errcode = '42501', message = 'Sesión autenticada requerida.';
  end if;
  if p_activador_id is null or p_equipo_id is null then
    raise exception using errcode = '22004', message = 'Activador y equipo son obligatorios.';
  end if;

  select
    regexp_replace(
      translate(lower(btrim(coalesce(a.rol, ''))), 'áéíóúüñ', 'aeiouun'),
      '[^a-z0-9]+',
      '_',
      'g'
    ),
    lower(btrim(coalesce(a.estado, '')))
  into v_rol, v_estado
  from public.activadores a
  where a.usuario_id = v_usuario_id;

  if not found or v_estado <> 'activo' then
    raise exception using errcode = '42501', message = 'Usuario inexistente o inactivo.';
  end if;

  v_es_admin := v_rol in ('admin', 'administrador', 'administrator')
    or v_rol like 'admin\_%' escape '\'
    or v_rol like 'administrador\_%' escape '\'
    or v_rol like 'administrator\_%' escape '\';
  v_es_lider := v_rol in ('lider', 'leader', 'supervisor', 'lider_activador', 'activador_lider', 'leader_activator', 'activator_leader')
    or v_rol like 'lider\_%' escape '\'
    or v_rol like 'leader\_%' escape '\'
    or v_rol like 'supervisor\_%' escape '\'
    or ((v_rol like '%lider%' or v_rol like '%leader%') and v_rol like '%activador%');

  if not v_es_admin and not v_es_lider then
    raise exception using errcode = '42501', message = 'El usuario no tiene acceso a Control Activadores.';
  end if;

  select h.lider_id
  into v_lider_equipo_id
  from public.equipo_lider_historial h
  join public.equipos e on e.id = h.equipo_id and e.activo = true
  join public.activadores l
    on l.usuario_id = h.lider_id
   and lower(btrim(coalesce(l.estado, ''))) = 'activo'
  where h.equipo_id = p_equipo_id
    and h.fin is null
    and (v_es_admin or h.lider_id = v_usuario_id)
  limit 1;

  if v_lider_equipo_id is null then
    raise exception using errcode = '42501', message = 'El equipo no está dentro del alcance del usuario.';
  end if;

  select
    a.equipo_id,
    exists (
      select 1
      from public.activador_equipo_historial hx
      where hx.activador_id = a.usuario_id
    )
  into v_equipo_actual_id, v_activador_tiene_historial
  from public.activadores a
  where a.usuario_id = p_activador_id
    and lower(btrim(coalesce(a.estado, ''))) = 'activo'
    and (
      exists (
        select 1
        from public.activador_equipo_historial ah
        where ah.activador_id = a.usuario_id
          and ah.equipo_id = p_equipo_id
          and ah.fin is null
      )
      or (
        a.equipo_id = p_equipo_id
        and not exists (
          select 1
          from public.activador_equipo_historial ah
          where ah.activador_id = a.usuario_id
            and ah.fin is null
        )
      )
    );

  if not found then
    raise exception using errcode = '42501', message = 'El activador no pertenece actualmente al equipo solicitado.';
  end if;

  return query
  with activaciones_base as (
    select
      ac.*,
      coalesce(ac.created_at, ac.fecha_activacion::timestamp at time zone 'UTC') as momento
    from public.activaciones ac
    where ac.usuario_id = p_activador_id
      and (p_desde is null or coalesce(ac.fecha_activacion, ac.created_at::date) >= p_desde)
      and (p_hasta is null or coalesce(ac.fecha_activacion, ac.created_at::date) <= p_hasta)
  ),
  activaciones_resueltas as (
    select
      ac.*,
      coalesce(
        ac.equipo_id_registro,
        ah.equipo_id,
        case when not v_activador_tiene_historial then v_equipo_actual_id end
      ) as equipo_atribuido_id,
      coalesce(ac.lider_id_registro, lh.lider_id) as lider_atribuido_id
    from activaciones_base ac
    left join lateral (
      select h.equipo_id
      from public.activador_equipo_historial h
      where ac.equipo_id_registro is null
        and h.activador_id = ac.usuario_id
        and ac.momento >= h.inicio
        and (h.fin is null or ac.momento < h.fin)
      order by h.inicio desc
      limit 1
    ) ah on true
    left join lateral (
      select h.lider_id
      from public.equipo_lider_historial h
      where ac.lider_id_registro is null
        and h.equipo_id = coalesce(
          ac.equipo_id_registro,
          ah.equipo_id,
          case when not v_activador_tiene_historial then v_equipo_actual_id end
        )
        and ac.momento >= h.inicio
        and (h.fin is null or ac.momento < h.fin)
      order by h.inicio desc
      limit 1
    ) lh on true
  )
  select
    ac.id,
    ac.usuario_id,
    ac.fecha_activacion,
    ac.created_at,
    ac.tipo_activacion,
    ac.nombres_cliente,
    ac.apellidos_cliente,
    ac.plaza,
    ac.foto_url,
    ac.foto_cash_in,
    ac.equipo_id_registro,
    ac.lider_id_registro
  from activaciones_resueltas ac
  where ac.equipo_atribuido_id = p_equipo_id
    and ac.lider_atribuido_id = v_lider_equipo_id
  order by coalesce(ac.fecha_activacion, ac.created_at::date) desc, ac.created_at desc;
end;
$function$;

-- control_activadores_jerarquia(p_desde date, p_hasta date)
-- retorno: TABLE(lider_id uuid, lider_nombre text, equipo_id uuid, equipo_numero bigint, equipo_nombre text, activador_id uuid, activador_nombre text, hoy bigint, semana bigint, mes bigint, total bigint)
-- security_definer: true
-- config: ["search_path=\"\""]
CREATE OR REPLACE FUNCTION public.control_activadores_jerarquia(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(lider_id uuid, lider_nombre text, equipo_id uuid, equipo_numero bigint, equipo_nombre text, activador_id uuid, activador_nombre text, hoy bigint, semana bigint, mes bigint, total bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usuario_id uuid := auth.uid();
  v_rol text;
  v_estado text;
  v_es_admin boolean;
  v_es_lider boolean;
begin
  if v_usuario_id is null then
    raise exception using errcode = '42501', message = 'Sesión autenticada requerida.';
  end if;

  select
    regexp_replace(
      translate(lower(btrim(coalesce(a.rol, ''))), 'áéíóúüñ', 'aeiouun'),
      '[^a-z0-9]+',
      '_',
      'g'
    ),
    lower(btrim(coalesce(a.estado, '')))
  into v_rol, v_estado
  from public.activadores a
  where a.usuario_id = v_usuario_id;

  if not found or v_estado <> 'activo' then
    raise exception using errcode = '42501', message = 'Usuario inexistente o inactivo.';
  end if;

  v_es_admin := v_rol in ('admin', 'administrador', 'administrator')
    or v_rol like 'admin\_%' escape '\'
    or v_rol like 'administrador\_%' escape '\'
    or v_rol like 'administrator\_%' escape '\';
  v_es_lider := v_rol in ('lider', 'leader', 'supervisor', 'lider_activador', 'activador_lider', 'leader_activator', 'activator_leader')
    or v_rol like 'lider\_%' escape '\'
    or v_rol like 'leader\_%' escape '\'
    or v_rol like 'supervisor\_%' escape '\'
    or ((v_rol like '%lider%' or v_rol like '%leader%') and v_rol like '%activador%');

  if not v_es_admin and not v_es_lider then
    raise exception using errcode = '42501', message = 'El usuario no tiene acceso a Control Activadores.';
  end if;

  return query
  with equipos_alcance as (
    select
      h.lider_id,
      l.nombre as lider_nombre,
      e.id as equipo_id,
      e.numero as equipo_numero,
      e.nombre as equipo_nombre
    from public.equipo_lider_historial h
    join public.equipos e
      on e.id = h.equipo_id
     and e.activo = true
    join public.activadores l
      on l.usuario_id = h.lider_id
     and lower(btrim(coalesce(l.estado, ''))) = 'activo'
    where h.fin is null
      and (v_es_admin or h.lider_id = v_usuario_id)
  ),
  miembros_vigentes as (
    select h.equipo_id, h.activador_id
    from public.activador_equipo_historial h
    where h.fin is null

    union

    select a.equipo_id, a.usuario_id
    from public.activadores a
    where a.equipo_id is not null
      and not exists (
        select 1
        from public.activador_equipo_historial h
        where h.activador_id = a.usuario_id
          and h.fin is null
      )
  ),
  jerarquia as (
    select
      ea.lider_id,
      ea.lider_nombre,
      ea.equipo_id,
      ea.equipo_numero,
      ea.equipo_nombre,
      a.usuario_id as activador_id,
      a.nombre as activador_nombre,
      a.equipo_id as equipo_actual_id
    from equipos_alcance ea
    left join miembros_vigentes mv on mv.equipo_id = ea.equipo_id
    left join public.activadores a
      on a.usuario_id = mv.activador_id
     and lower(btrim(coalesce(a.estado, ''))) = 'activo'
  ),
  activadores_con_historial as (
    select distinct h.activador_id
    from public.activador_equipo_historial h
  ),
  activaciones_base as (
    select
      ac.*,
      j.equipo_actual_id,
      coalesce(ac.created_at, ac.fecha_activacion::timestamp at time zone 'UTC') as momento,
      coalesce(ac.fecha_activacion, ac.created_at::date) as fecha
    from public.activaciones ac
    join (
      select distinct x.activador_id, x.equipo_actual_id
      from jerarquia x
      where x.activador_id is not null
    ) j on j.activador_id = ac.usuario_id
    where (p_desde is null or coalesce(ac.fecha_activacion, ac.created_at::date) >= p_desde)
      and (p_hasta is null or coalesce(ac.fecha_activacion, ac.created_at::date) <= p_hasta)
  ),
  activaciones_resueltas as (
    select
      ac.usuario_id,
      ac.fecha,
      coalesce(
        ac.equipo_id_registro,
        ah.equipo_id,
        case when ch.activador_id is null then ac.equipo_actual_id end
      ) as equipo_atribuido_id,
      coalesce(ac.lider_id_registro, lh.lider_id) as lider_atribuido_id
    from activaciones_base ac
    left join activadores_con_historial ch on ch.activador_id = ac.usuario_id
    left join lateral (
      select h.equipo_id
      from public.activador_equipo_historial h
      where ac.equipo_id_registro is null
        and h.activador_id = ac.usuario_id
        and ac.momento >= h.inicio
        and (h.fin is null or ac.momento < h.fin)
      order by h.inicio desc
      limit 1
    ) ah on true
    left join lateral (
      select h.lider_id
      from public.equipo_lider_historial h
      where ac.lider_id_registro is null
        and h.equipo_id = coalesce(
          ac.equipo_id_registro,
          ah.equipo_id,
          case when ch.activador_id is null then ac.equipo_actual_id end
        )
        and ac.momento >= h.inicio
        and (h.fin is null or ac.momento < h.fin)
      order by h.inicio desc
      limit 1
    ) lh on true
  ),
  metricas as (
    select
      ac.usuario_id,
      ac.equipo_atribuido_id,
      ac.lider_atribuido_id,
      count(*) filter (where ac.fecha = current_date) as hoy,
      count(*) filter (
        where ac.fecha between date_trunc('week', current_date)::date and current_date
      ) as semana,
      count(*) filter (
        where ac.fecha between date_trunc('month', current_date)::date and current_date
      ) as mes,
      count(*) as total
    from activaciones_resueltas ac
    group by ac.usuario_id, ac.equipo_atribuido_id, ac.lider_atribuido_id
  )
  select
    j.lider_id,
    j.lider_nombre,
    j.equipo_id,
    j.equipo_numero,
    j.equipo_nombre,
    j.activador_id,
    j.activador_nombre,
    coalesce(m.hoy, 0)::bigint,
    coalesce(m.semana, 0)::bigint,
    coalesce(m.mes, 0)::bigint,
    coalesce(m.total, 0)::bigint
  from jerarquia j
  left join metricas m
    on m.usuario_id = j.activador_id
   and m.equipo_atribuido_id = j.equipo_id
   and m.lider_atribuido_id = j.lider_id
  order by j.lider_nombre, j.equipo_numero, j.equipo_nombre, j.activador_nombre;
end;
$function$;

-- GRANTs informados por information_schema.routine_privileges
REVOKE ALL ON FUNCTION public.control_activaciones_detalle(uuid, uuid, date, date) FROM public, anon;
REVOKE ALL ON FUNCTION public.control_activadores_jerarquia(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.control_activaciones_detalle(uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.control_activaciones_detalle(uuid, uuid, date, date) TO postgres;
GRANT EXECUTE ON FUNCTION public.control_activaciones_detalle(uuid, uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.control_activadores_jerarquia(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.control_activadores_jerarquia(date, date) TO postgres;
GRANT EXECUTE ON FUNCTION public.control_activadores_jerarquia(date, date) TO service_role;

commit;
