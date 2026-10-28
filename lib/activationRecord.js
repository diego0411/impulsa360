const { resolverElegibilidadProductos } = require('./elegibilidadProductos');

const CAMPOS_ACTIVACION_SUPABASE = [
  'id',
  'nombres_cliente',
  'apellidos_cliente',
  'ci_cliente',
  'telefono_cliente',
  'email_cliente',
  'descargo_app',
  'registro',
  'cash_in',
  'cash_out',
  'p2p',
  'qr_fisico',
  'hubo_error',
  'descripcion_error',
  'tipo_error',
  'foto_cash_in',
  'tipo_tienda',
  'rubro_comercio',
  'rubro_comercio_otro',
  'comercio_fuera_mercado',
  'es_plaza_temporal',
  'plaza_temporal',
  'tipo_activacion',
  'base_activacion',
  'es_reactivacion',
  'tamano_tienda',
  'tipo_comercio',
  'foto_url',
  'fecha_activacion',
  'latitud',
  'longitud',
  'reactivacion_comercio',
  'respaldo',
  'creditos',
  'remesas',
  'ciudad_activacion',
  'zona_activacion',
  'distrito_gps',
  'region_gps',
  'plaza',
  'estado_sync',
  'dispositivo',
];

const resolverProductosGuardados = (formulario = {}) => {
  const elegibilidad = resolverElegibilidadProductos({
    tipoGrupo: formulario.tipo_grupo,
    tipoActivacion: formulario.tipo_activacion,
  });
  return {
    creditos: elegibilidad.creditos && formulario.creditos === true,
    remesas: elegibilidad.remesas && formulario.remesas === true,
  };
};

const normalizarValorOpcionalDb = (value) => {
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
};

const construirPayloadSincronizacionActivacion = (formulario = {}) => {
  const payload = CAMPOS_ACTIVACION_SUPABASE.reduce((acc, key) => {
    if (formulario[key] !== undefined) acc[key] = normalizarValorOpcionalDb(formulario[key]);
    return acc;
  }, {});
  const clean = { ...payload };
  const tipo = clean.tipo_activacion;
  const base = clean.base_activacion;

  if (base !== 'tienda_barrio') {
    clean.tipo_tienda = null;
    clean.tamano_tienda = null;
  }
  if (base !== 'comercio') {
    clean.tipo_comercio = null;
    clean.rubro_comercio = null;
    clean.rubro_comercio_otro = null;
    clean.comercio_fuera_mercado = null;
  }
  if (tipo !== 'reactivacion_comercio' && tipo !== 'reactivacion_transeunte' && tipo !== 'reactivacion') {
    clean.reactivacion_comercio = false;
  }

  return clean;
};

module.exports = {
  construirPayloadSincronizacionActivacion,
  resolverProductosGuardados,
};
