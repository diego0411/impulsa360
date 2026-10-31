const PLAZA_PLACEHOLDERS = new Set(['no_especificada', 'sin_plaza', 'no_aplica']);

const normalizarClave = (valor = '') =>
  String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const slugClave = (valor = '') => normalizarClave(valor).replace(/\s+/g, '_');

const PLAZAS_CANONICAS = {
  santa_cruz: {
    label: 'Santa Cruz de la Sierra',
    aliases: ['santa_cruz', 'santa_cruz_de_la_sierra', 'santa cruz', 'santa cruz de la sierra'],
  },
  la_paz: {
    label: 'La Paz',
    aliases: ['la_paz', 'la paz'],
  },
  el_alto: {
    label: 'El Alto',
    aliases: ['el_alto', 'el alto'],
  },
};

const aliasPorClave = Object.entries(PLAZAS_CANONICAS).reduce((acc, [key, config]) => {
  config.aliases.forEach((alias) => {
    acc[slugClave(alias)] = key;
  });
  return acc;
}, {});

const titleCase = (valor = '') =>
  normalizarClave(valor)
    .split(' ')
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');

export const obtenerPlazaCanonica = (valor = '') => {
  const original = String(valor || '').trim();
  const slug = slugClave(original);
  if (!slug || PLAZA_PLACEHOLDERS.has(slug)) return { key: '', label: '', original };

  const canonicalKey = aliasPorClave[slug] || slug;
  const canonicalConfig = PLAZAS_CANONICAS[canonicalKey];
  return {
    key: canonicalKey,
    label: canonicalConfig?.label || titleCase(original),
    original,
  };
};

export const etiquetaPlaza = (valor = '', fallback = '') => {
  const plaza = obtenerPlazaCanonica(valor);
  return plaza.label || fallback;
};

export const tienePlazaValida = (valor = '') => Boolean(obtenerPlazaCanonica(valor).key);

export const deduplicarPlazasPorEtiqueta = (plazas = []) => {
  const vistas = new Map();
  (Array.isArray(plazas) ? plazas : []).forEach((plaza) => {
    const nombre = plaza?.nombre || plaza?.label || plaza?.plaza || '';
    const canonica = obtenerPlazaCanonica(nombre);
    if (!canonica.key) return;

    const dedupeKey = `${canonica.key}:${canonica.label}`;
    if (!vistas.has(dedupeKey)) {
      vistas.set(dedupeKey, {
        ...plaza,
        nombre_legible: canonica.label,
      });
    }
  });
  return [...vistas.values()];
};

export const resolverPlazaBaseAutorizada = (perfil = {}) => {
  if (!perfil || perfil.organizacion_pendiente === true) return null;

  const plazaBase = String(perfil.plaza_base || '').trim();
  if (tienePlazaValida(plazaBase)) return plazaBase;

  // El perfil remoto conserva `plaza` como snapshot compatible cuando no
  // expone todavía la plaza organizacional con `plaza_base`.
  const plazaLegacy = String(perfil.plaza || '').trim();
  return tienePlazaValida(plazaLegacy) ? plazaLegacy : null;
};

export const estaPlazaTemporalVigente = (row, now = new Date()) => {
  if (!row || typeof row !== 'object') return false;
  if ('activo' in row && row.activo !== true) return false;
  if ('vigente' in row && row.vigente !== true) return false;
  if (row.cancelado_at) return false;

  const inicio = row.inicio || row.fecha_inicio || row.vigente_desde;
  const fin = row.fin || row.fecha_fin || row.vigente_hasta;
  const fechaInicio = inicio ? new Date(inicio) : null;
  const fechaFin = fin ? new Date(fin) : null;
  if (fechaInicio && Number.isNaN(fechaInicio.getTime())) return false;
  if (fechaFin && Number.isNaN(fechaFin.getTime())) return false;
  if (fechaInicio && fechaInicio > now) return false;
  if (fechaFin && fechaFin <= now) return false;
  return true;
};

export const filtrarPlazasTemporalesAutorizadas = (plazas = [], plazaBase = null) => {
  const vistas = new Map();
  const baseKey = obtenerPlazaCanonica(plazaBase).key;

  deduplicarPlazasPorEtiqueta(plazas).forEach((plaza) => {
    if (!estaPlazaTemporalVigente(plaza)) return;
    const canonica = obtenerPlazaCanonica(plaza?.nombre);
    if (!canonica.key || canonica.key === baseKey || vistas.has(canonica.key)) return;
    vistas.set(canonica.key, plaza);
  });
  return [...vistas.values()];
};

export const validarPlazaAutorizada = ({
  plazaBase,
  plazasTemporales = [],
  esPlazaTemporal,
  plazaTemporal,
}) => {
  const temporales = filtrarPlazasTemporalesAutorizadas(plazasTemporales, plazaBase);
  if (!tienePlazaValida(plazaBase) && temporales.length === 0) {
    return 'No tienes una plaza autorizada para registrar activaciones.';
  }
  if (!esPlazaTemporal) {
    return tienePlazaValida(plazaBase) ? null : 'Selecciona una plaza autorizada.';
  }
  return temporales.some((item) => item?.nombre === plazaTemporal)
    ? null
    : 'La plaza temporal seleccionada no está autorizada.';
};
