import { isTimeoutError } from './asyncTimeout';
import { recordEvent } from './telemetry';

const normalizarRol = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_|_$/g, '');

export const obtenerRolesAdicionalesCache = (cache, rolPrincipal) => {
  if (Array.isArray(cache?.roles_adicionales_confirmados)) {
    return { available: true, roles: cache.roles_adicionales_confirmados };
  }
  if (!Array.isArray(cache?.roles)) return { available: false, roles: [] };
  const principal = normalizarRol(rolPrincipal);
  const roles = cache.roles.filter((rol) => normalizarRol(rol) !== principal);
  return { available: roles.length > 0, roles };
};

const extraerRoles = (filas) => (Array.isArray(filas) ? filas : [])
  .map((fila) => fila?.rol)
  .filter((rol) => typeof rol === 'string' && rol.trim());

export const resolverEstadoRoles = ({ filas, error, cache, rolPrincipal, revision }) => {
  const cacheRoles = obtenerRolesAdicionalesCache(cache, rolPrincipal);
  const actualizados = !error;
  const rolesAdicionales = actualizados ? extraerRoles(filas) : cacheRoles.roles;
  const usoCache = !actualizados && cacheRoles.available;
  const roles = [rolPrincipal, ...rolesAdicionales]
    .filter((rol) => typeof rol === 'string' && rol.trim());

  return {
    actualizados,
    usoCache,
    camposUsuario: {
      roles: Array.from(new Set(roles)),
      ...((actualizados || cacheRoles.available) && {
        roles_adicionales_confirmados: rolesAdicionales,
      }),
      roles_actualizados: actualizados,
      roles_fuente: actualizados ? 'servidor' : (usoCache ? 'cache' : 'no_disponible'),
      roles_confirmados_at: actualizados
        ? new Date().toISOString()
        : (cache?.roles_confirmados_at || null),
      roles_cache_revision: revision,
    },
  };
};

export const mensajeRolesNoActualizados = (usoCache) => (usoCache
  ? 'No se pudieron actualizar los roles adicionales. Se conservan los últimos roles confirmados de este usuario.'
  : 'No se pudieron actualizar los roles adicionales. No hay roles adicionales confirmados disponibles.');

const diagnosticoError = (error) => {
  const statusRaw = Number(error?.status ?? error?.statusCode);
  const status = Number.isFinite(statusRaw) && statusRaw >= 100 && statusRaw <= 599
    ? String(statusRaw)
    : 'na';
  const codeRaw = String(error?.code || '').trim();
  const code = /^[a-z0-9_-]{1,12}$/i.test(codeRaw) ? codeRaw.toLowerCase() : 'na';
  const message = String(error?.message || '').toLowerCase();
  let category = 'postgrest';
  if (isTimeoutError(error)) category = 'timeout';
  else if (
    status === '401'
    || ['pgrst301', 'pgrst302', '28000', '28p01'].includes(codeRaw.toLowerCase())
    || /jwt|auth|session/.test(codeRaw.toLowerCase())
  ) category = 'auth';
  else if (status === '403' || codeRaw === '42501') category = 'forbidden';
  else if (/network request failed|failed to fetch|fetch failed|network error|internet|connection/.test(message)) category = 'network';
  return { category, code, status };
};

export const registrarDiagnosticoRoles = ({ error, cacheUsed, connected, reachable }) => {
  const diagnostico = error
    ? diagnosticoError(error)
    : { category: 'success', code: 'ok', status: '200' };
  const stage = [
    cacheUsed ? 'c1' : 'c0',
    connected ? 'n1' : 'n0',
    reachable === true ? 'r1' : (reachable === false ? 'r0' : 'rx'),
    `s${diagnostico.status}`,
    `c${diagnostico.code}`,
  ].join('_').slice(0, 32);
  recordEvent('auth_change', {
    app_state: 'active',
    screen: 'control_roles',
    phase: 'roles_load',
    sync_stage: stage,
    error_category: diagnostico.category,
  }).catch(() => {});
};
