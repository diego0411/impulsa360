// Reglas puras de elegibilidad de checkboxes opcionales (Créditos / Remesas).
// Identificadores reales de (tipo_grupo, tipo_activacion) de Impulsa360.
// Sin dependencias de UI, BD ni sincronización.
//
// Créditos: todos los subtipos de Tienda de Barrio, reactivaciones,
// reimpresiones QR y cliente antiguo.
// Remesas: todos los subtipos de Tienda de Barrio, Transeúnte vigente
// (transeunte/reactivacion_transeunte) y Comercio (comercio/comercio y
// comercio/limbo).
// El Transeúnte legacy (cliente_antiguo) conserva Créditos pero no Remesas.
// Cualquier otro caso: ambos no habilitados.

const normalizar = (value) => String(value || '').trim().toLowerCase();

const esReactivacion = (tipo) => tipo.includes('reactivacion');
const esReimpresionQr = (tipo) => tipo === 'reimpresion_qr';
const esClienteAntiguo = (tipo) => tipo === 'cliente_antiguo';
const TIPOS_TIENDA_BARRIO = new Set([
  'comercio',
  'no_habilitado',
  'reactivacion',
  'config_cuenta',
  'reimpresion_qr',
]);
const esTiendaBarrio = (grupo, tipo) => grupo === 'tienda_barrio'
  && TIPOS_TIENDA_BARRIO.has(tipo);
const esTranseunteVigente = (grupo, tipo) => grupo === 'transeunte'
  && (tipo === 'transeunte' || tipo === 'reactivacion_transeunte');

const resolverElegibilidadProductos = ({ tipoGrupo, tipoActivacion } = {}) => {
  const grupo = normalizar(tipoGrupo);
  const tipo = normalizar(tipoActivacion);

  const creditos = esTiendaBarrio(grupo, tipo)
    || esReactivacion(tipo)
    || esReimpresionQr(tipo)
    || esClienteAntiguo(tipo);
  const remesas = esTiendaBarrio(grupo, tipo)
    || esTranseunteVigente(grupo, tipo)
    || (grupo === 'comercio' && tipo === 'comercio')
    || (grupo === 'comercio' && tipo === 'limbo');

  return { creditos, remesas };
};

module.exports = {
  resolverElegibilidadProductos,
};
