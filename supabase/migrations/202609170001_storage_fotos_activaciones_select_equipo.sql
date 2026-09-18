-- 202609170001_storage_fotos_activaciones_select_equipo.sql
-- SELECT aditivo en fotos-activaciones: propietario, administrador activo y
-- lider activo SOLO para fotos cuyo dueno pertenece hoy a uno de sus equipos.
-- Reutiliza la logica vigente de public.control_activaciones_detalle
-- (202607310001_control_activadores_rpc.sql:261-305 alcance lider,
-- 307-339 pertenencia activador): equipo_lider_historial.fin IS NULL
-- (+ equipos.activo, lider activo) y activador_equipo_historial.fin IS NULL
-- con fallback a activadores.equipo_id. No toca INSERT/UPDATE/DELETE
-- ni las policies existentes (select_own sigue intacta).
begin;

drop policy if exists storage_fotos_activaciones_select_equipo
  on storage.objects;

create policy storage_fotos_activaciones_select_equipo
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'fotos-activaciones'
    and (
      -- 1) propietario de la ruta: activaciones/<auth.uid>/% (igual que select_own)
      name like ('activaciones/' || auth.uid()::text || '/%')
      -- 2) administrador activo (misma normalizacion de rol que el RPC)
      or exists (
        select 1
        from public.activadores a
        join lateral (
          select regexp_replace(
            translate(lower(btrim(coalesce(a.rol, ''))), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+',
            '_',
            'g'
          ) as rol_norm
        ) n on true
        where a.usuario_id = auth.uid()
          and lower(btrim(coalesce(a.estado, ''))) = 'activo'
          and (
            n.rol_norm in ('admin', 'administrador', 'administrator')
            or n.rol_norm like 'admin\_%' escape '\'
            or n.rol_norm like 'administrador\_%' escape '\'
            or n.rol_norm like 'administrator\_%' escape '\'
          )
      )
      -- 3) lider activo, solo duenos vigentes de sus equipos (misma vigencia que el RPC)
      or exists (
        select 1
        from public.activadores l
        join lateral (
          select regexp_replace(
            translate(lower(btrim(coalesce(l.rol, ''))), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+',
            '_',
            'g'
          ) as rol_norm
        ) n on true
        join public.equipo_lider_historial h
          on h.lider_id = l.usuario_id
         and h.fin is null
        join public.equipos e
          on e.id = h.equipo_id
         and e.activo = true
        where l.usuario_id = auth.uid()
          and lower(btrim(coalesce(l.estado, ''))) = 'activo'
          and (
            n.rol_norm in ('lider', 'leader', 'supervisor', 'lider_activador', 'activador_lider', 'leader_activator', 'activator_leader')
            or n.rol_norm like 'lider\_%' escape '\'
            or n.rol_norm like 'leader\_%' escape '\'
            or n.rol_norm like 'supervisor\_%' escape '\'
            or ((n.rol_norm like '%lider%' or n.rol_norm like '%leader%') and n.rol_norm like '%activador%')
          )
          and h.equipo_id in (
            select hh.equipo_id
            from public.activador_equipo_historial hh
            where hh.activador_id = (
              case
                when name ~ '^activaciones/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
                then split_part(name, '/', 2)::uuid
                else null
              end
            )
              and hh.fin is null
            union
            select a2.equipo_id
            from public.activadores a2
            where a2.usuario_id = (
              case
                when name ~ '^activaciones/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
                then split_part(name, '/', 2)::uuid
                else null
              end
            )
              and a2.equipo_id is not null
              and not exists (
                select 1
                from public.activador_equipo_historial hx
                where hx.activador_id = a2.usuario_id
                  and hx.fin is null
              )
          )
      )
    )
  );

commit;
