-- Verificación posterior, solo lectura. Ejecutar después de aplicar o revertir.

-- 1. Firma, SECURITY DEFINER, search_path y definición efectiva.
select
  p.oid::regprocedure as firma,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') as configuracion,
  pg_get_function_result(p.oid) as retorno,
  pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid in (
    'public.control_activadores_jerarquia(date, date)'::regprocedure,
    'public.control_activaciones_detalle(uuid, uuid, date, date)'::regprocedure
  )
order by firma::text;

-- 2. ACL de ejecución. Deben figurar authenticated, postgres y service_role;
-- public y anon no deben tener EXECUTE.
select
  routine_name,
  specific_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'control_activadores_jerarquia',
    'control_activaciones_detalle'
  )
order by routine_name, grantee, privilege_type;

-- 3. Plantilla para cada escenario de rol. Sustituir UUID y periodo por valores
-- existentes. Ejecutar un escenario por vez; ROLLBACK evita cambios persistentes.
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claim.sub', '<usuario_uuid>', true);
-- select set_config('request.jwt.claim.role', 'authenticated', true);
-- select * from public.control_activadores_jerarquia(current_date - 30, current_date);
-- rollback;
--
-- Resultados esperados:
--   - activador sin liderazgo, facturador solo y banco: error 42501.
--   - lider principal, lider adicional, activador + lider y facturador + lider:
--     resultado limitado a equipos bajo liderazgo actual.
--   - usuario inactivo aun con rol adicional: error 42501.
