const CEDULA_IDENTIDAD_PATTERN = /^\d{6,8}$/;

const MENSAJE_CEDULA_IDENTIDAD = 'La cédula debe contener entre 6 y 8 dígitos numéricos.';
const MENSAJE_DATOS_CLIENTE_INCOMPLETOS = 'Completa los datos del cliente';

// Datos del cliente exigidos en TODOS los tipos y subtipos de activación
// (Comercio, Tienda de Barrio y Transeúnte). Punto único de verdad para la
// obligatoriedad y para el listado de campos faltantes.
const CAMPOS_DATOS_CLIENTE = [
  { campo: 'nombres_cliente', etiqueta: 'Nombres' },
  { campo: 'apellidos_cliente', etiqueta: 'Apellidos' },
  { campo: 'ci_cliente', etiqueta: 'Cédula de Identidad' },
  { campo: 'telefono_cliente', etiqueta: 'Teléfono' },
];

const normalizarTextoCampo = (value) => (
  typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
);

const esCedulaIdentidadValida = (value) => CEDULA_IDENTIDAD_PATTERN.test(String(value || '').trim());

const resolverCamposObligatoriosFormulario = (data = {}) => {
  const tipoGrupo = String(data.tipo_grupo || '').toLowerCase();
  const tipoActivacion = String(data.tipo_activacion || '').toLowerCase();
  const tieneTipoSeleccionado = Boolean(tipoGrupo && tipoActivacion);
  // Ciudad y zona siguen dependiendo del subtipo: transeúnte y cliente antiguo
  // no las exigen. Los cuatro datos del cliente son siempre obligatorios.
  const requiereUbicacion = tieneTipoSeleccionado
    && !['transeunte', 'cliente_antiguo'].includes(tipoActivacion);
  const requiereComercioGeneral = tipoGrupo === 'comercio'
    && ['comercio', 'reactivacion_comercio'].includes(tipoActivacion);

  return {
    tipo_grupo: true,
    tipo_activacion: true,
    ciudad_activacion: requiereUbicacion,
    zona_activacion: requiereUbicacion,
    tamano_tienda: tipoGrupo === 'tienda_barrio',
    rubro_comercio: requiereComercioGeneral,
    rubro_comercio_otro: requiereComercioGeneral && data.rubro_comercio === 'Otro',
    comercio_fuera_mercado: requiereComercioGeneral,
    nombres_cliente: true,
    apellidos_cliente: true,
    ci_cliente: true,
    telefono_cliente: true,
    tipo_error: data.hubo_error === true,
    descripcion_error: data.hubo_error === true && data.tipo_error === 'Otro',
  };
};

// Devuelve los datos del cliente que faltan (vacío, null, undefined o solo
// espacios), respetando el orden de la UI.
const resolverCamposClienteFaltantes = (data = {}) => CAMPOS_DATOS_CLIENTE
  .filter(({ campo }) => normalizarTextoCampo(data[campo]).trim().length === 0)
  .map(({ campo, etiqueta }) => ({ campo, etiqueta }));

const resolverVisibilidadFotografias = ({
  tipoGrupo,
  tipoActivacion,
  requiereEvidencia,
  requiereCashIn,
} = {}) => {
  const tieneTipoSeleccionado = Boolean(
    String(tipoGrupo || '').trim() && String(tipoActivacion || '').trim()
  );
  return {
    mostrarEvidencia: tieneTipoSeleccionado && requiereEvidencia === true,
    mostrarCashIn: tieneTipoSeleccionado && requiereCashIn === true,
  };
};

module.exports = {
  CAMPOS_DATOS_CLIENTE,
  MENSAJE_CEDULA_IDENTIDAD,
  MENSAJE_DATOS_CLIENTE_INCOMPLETOS,
  esCedulaIdentidadValida,
  resolverCamposClienteFaltantes,
  resolverCamposObligatoriosFormulario,
  resolverVisibilidadFotografias,
};
