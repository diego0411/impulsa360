const booleanPretty = (value) => (
  value === true ? 'Sí' : value === false ? 'No' : '—'
);

const resolverIndicadorReactivacion = (detalle = {}) => {
  const valores = [detalle.es_reactivacion, detalle.reactivacion_comercio];
  if (valores.some((value) => value === true)) return true;
  if (valores.some((value) => value === false)) return false;
  return null;
};

const ETIQUETAS_GRUPO = {
  comercio: 'Comercio',
  tienda_barrio: 'Tienda de Barrio',
  transeunte: 'Transeúnte',
};

const GRUPO_POR_TIPO_EXCLUSIVO = {
  config_cuenta: 'tienda_barrio',
  reactivacion: 'tienda_barrio',
  limbo: 'comercio',
  reactivacion_comercio: 'comercio',
  transeunte: 'transeunte',
  reactivacion_transeunte: 'transeunte',
};

const resolverGrupoActivacion = (detalle = {}) => {
  const grupoExplicito = String(detalle.tipo_grupo || '').trim().toLowerCase();
  if (ETIQUETAS_GRUPO[grupoExplicito]) return ETIQUETAS_GRUPO[grupoExplicito];

  const candidatos = new Set();
  const base = String(detalle.base_activacion || '').trim().toLowerCase();
  if (ETIQUETAS_GRUPO[base]) candidatos.add(base);

  const tipo = String(detalle.tipo_activacion || '').trim().toLowerCase();
  const grupoPorTipo = GRUPO_POR_TIPO_EXCLUSIVO[tipo];
  if (grupoPorTipo) candidatos.add(grupoPorTipo);

  if (candidatos.size !== 1) return null;
  return ETIQUETAS_GRUPO[[...candidatos][0]] || null;
};

module.exports = {
  booleanPretty,
  resolverGrupoActivacion,
  resolverIndicadorReactivacion,
};
