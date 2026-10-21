-- Verificación posterior, solo lectura. Ejecutar después de aplicar.
-- Tras rollback, los bloques 1 y 3 siguen verificando función y ACL; el bloque
-- 2 debe mostrar usa_fecha_bolivia=false y sin_current_date=false.

-- 1. Firma, retorno, SECURITY DEFINER, search_path y definición efectiva.
select
  p.oid::regprocedure as firma,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') as configuracion,
  pg_get_function_result(p.oid) as retorno,
  pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid = 'public.control_activadores_jerarquia(date, date)'::regprocedure;

-- 2. La aplicación debe usar exclusivamente la referencia Bolivia en Hoy/Semana/Mes.
with funcion as (
  select pg_get_functiondef('public.control_activadores_jerarquia(date, date)'::regprocedure) as definicion
)
select
  position('v_fecha_referencia date := (now() at time zone ''America/La_Paz'')::date' in definicion) > 0 as usa_fecha_bolivia,
  position('current_date' in definicion) = 0 as sin_current_date,
  position('date_trunc(''week'', v_fecha_referencia)' in definicion) > 0 as semana_bolivia,
  position('date_trunc(''month'', v_fecha_referencia)' in definicion) > 0 as mes_bolivia
from funcion;

-- 3. ACL efectiva. Deben existir EXECUTE para authenticated, postgres y service_role.
-- public y anon no deben tener EXECUTE.
select
  coalesce(r.rolname, 'public') as grantee,
  privilegio.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles r on r.oid = acl.grantee
cross join lateral (
  select case when acl.privilege_type = 'EXECUTE' then acl.privilege_type end as privilege_type
) privilegio
where n.nspname = 'public'
  and p.oid = 'public.control_activadores_jerarquia(date, date)'::regprocedure
  and privilegio.privilege_type is not null
order by grantee;
