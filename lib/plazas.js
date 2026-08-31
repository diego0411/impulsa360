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
