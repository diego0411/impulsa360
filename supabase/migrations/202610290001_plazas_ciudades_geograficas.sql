begin;

do $$
begin
  if to_regclass('public.plazas') is null then
    raise exception 'Preflight: public.plazas no existe';
  end if;
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'plazas'
      and c.relrowsecurity = true
  ) then
    raise exception 'Preflight: RLS debe estar habilitada en public.plazas';
  end if;
  if exists (
    with esperadas(nombre, debe_estar_activa) as (
      values
        ('4 cañadas', true),
        ('Camiri', true),
        ('Cochabamba', true),
        ('Concepcion', true),
        ('El Alto', true),
        ('La Paz', true),
        ('Montero', true),
        ('Oruro', true),
        ('Potosi', true),
        ('Riberalta', true),
        ('San Ignacio', true),
        ('Santa Cruz de la Sierra', true),
        ('Sucre', true),
        ('Tarija', true),
        ('Trinidad', true),
        ('Santa Cruz', true),
        ('PRUEBA', true),
        ('Evento Prueba', true)
    )
    select 1
    from esperadas e
    left join public.plazas p on p.nombre = e.nombre
    group by e.nombre, e.debe_estar_activa
    having count(p.id) <> 1
      or count(p.id) filter (where p.activa = e.debe_estar_activa) <> 1
  ) then
    raise exception 'Preflight: faltan, estan duplicadas o tienen estado activo inconsistente una o mas ciudades/plazas esperadas';
  end if;
end
$$;

alter table public.plazas
  add column if not exists es_ciudad_geografica boolean not null default false,
  add column if not exists aliases text[] not null default '{}'::text[];

update public.plazas
set es_ciudad_geografica = true
where nombre in (
  '4 cañadas',
  'Camiri',
  'Cochabamba',
  'Concepcion',
  'El Alto',
  'La Paz',
  'Montero',
  'Oruro',
  'Potosi',
  'Riberalta',
  'San Ignacio',
  'Santa Cruz de la Sierra',
  'Sucre',
  'Tarija',
  'Trinidad'
);

update public.plazas
set es_ciudad_geografica = false
where nombre in ('Santa Cruz', 'PRUEBA', 'Evento Prueba');

update public.plazas p
set aliases = array(
  select distinct expanded.alias
  from unnest(
    p.aliases || case p.nombre
      when '4 cañadas' then array['4 Cañadas', 'Cuatro Cañadas']::text[]
      when 'Concepcion' then array['Concepción']::text[]
      when 'Potosi' then array['Potosí']::text[]
      when 'San Ignacio' then array['San Ignacio de Velasco']::text[]
      when 'Santa Cruz de la Sierra' then array['Santa Cruz']::text[]
      else '{}'::text[]
    end
  ) as expanded(alias)
  where btrim(expanded.alias) <> ''
)
where nombre in ('4 cañadas', 'Concepcion', 'Potosi', 'San Ignacio', 'Santa Cruz de la Sierra');

do $$
begin
  if (
    select count(*)
    from public.plazas
    where es_ciudad_geografica = true
  ) <> 15
    or exists (
      select 1
      from public.plazas
      where es_ciudad_geografica = true
        and nombre not in (
          '4 cañadas', 'Camiri', 'Cochabamba', 'Concepcion', 'El Alto',
          'La Paz', 'Montero', 'Oruro', 'Potosi', 'Riberalta',
          'San Ignacio', 'Santa Cruz de la Sierra', 'Sucre', 'Tarija', 'Trinidad'
        )
    )
    or exists (
      select 1
      from public.plazas
      where nombre in ('Santa Cruz', 'PRUEBA', 'Evento Prueba')
        and es_ciudad_geografica = true
    )
  then
    raise exception 'Validacion final: la clasificacion geografica no coincide exactamente con las 15 ciudades esperadas';
  end if;
end
$$;

do $$
declare
  v_policy record;
  v_qual_normalizada text;
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'plazas'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'Preflight: existe una politica de mutacion sobre public.plazas aplicable a anon/authenticated/public';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'plazas'
      and cmd in ('ALL', 'SELECT')
      and roles && array['public', 'anon', 'authenticated']::name[]
      and policyname <> 'plazas_select_ciudades_geograficas_activas'
  ) then
    raise exception 'Preflight: existe otra politica SELECT/ALL sobre public.plazas aplicable a anon/authenticated/public';
  end if;

  select * into v_policy
    from pg_policies
    where schemaname = 'public'
      and tablename = 'plazas'
      and policyname = 'plazas_select_ciudades_geograficas_activas';

  if found then
    v_qual_normalizada := regexp_replace(lower(coalesce(v_policy.qual, '')), '[[:space:]()]', '', 'g');
    if v_policy.cmd <> 'SELECT'
      or v_policy.roles <> array['authenticated']::name[]
      or v_qual_normalizada not in (
        'activa=trueandes_ciudad_geografica=true',
        'es_ciudad_geografica=trueandactiva=true',
        'activaandes_ciudad_geografica',
        'es_ciudad_geograficaandactiva'
      )
    then
      raise exception 'Preflight: la politica plazas_select_ciudades_geograficas_activas no coincide con SELECT authenticated USING (activa AND es_ciudad_geografica)';
    end if;
  else
    create policy plazas_select_ciudades_geograficas_activas
      on public.plazas
      for select
      to authenticated
      using (activa = true and es_ciudad_geografica = true);
  end if;
end
$$;

grant select (id, nombre, nombre_normalizado, activa, es_ciudad_geografica, aliases)
  on public.plazas to authenticated;

commit;
