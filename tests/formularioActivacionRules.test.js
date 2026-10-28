const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const {
  CAMPOS_DATOS_CLIENTE,
  esCedulaIdentidadValida,
  resolverCamposClienteFaltantes,
  resolverCamposObligatoriosFormulario,
  resolverVisibilidadFotografias,
} = require('../lib/formularioActivacionRules');

const cargarReglasFotografias = () => {
  const filename = path.resolve('lib/reglasFotografias.js');
  const { code } = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  });
  const modulo = new Module(filename, module);
  modulo.filename = filename;
  modulo.paths = Module._nodeModulePaths(path.dirname(filename));
  modulo._compile(code, filename);
  return modulo.exports;
};

test('la cédula acepta únicamente entre 6 y 8 dígitos', () => {
  assert.equal(esCedulaIdentidadValida('123456'), true);
  assert.equal(esCedulaIdentidadValida('12345678'), true);
  assert.equal(esCedulaIdentidadValida('12345'), false);
  assert.equal(esCedulaIdentidadValida('123456789'), false);
  assert.equal(esCedulaIdentidadValida('12345A'), false);
});

test('los campos obligatorios cambian con el tipo sin volver obligatorio lo opcional', () => {
  const comercio = resolverCamposObligatoriosFormulario({
    tipo_grupo: 'comercio',
    tipo_activacion: 'comercio',
  });
  assert.equal(comercio.ci_cliente, true);
  assert.equal(comercio.rubro_comercio, true);
  assert.equal(comercio.tamano_tienda, false);

  const transeunte = resolverCamposObligatoriosFormulario({
    tipo_grupo: 'transeunte',
    tipo_activacion: 'transeunte',
  });
  // Los cuatro datos del cliente son obligatorios también para transeúnte.
  assert.equal(transeunte.nombres_cliente, true);
  assert.equal(transeunte.apellidos_cliente, true);
  assert.equal(transeunte.ci_cliente, true);
  assert.equal(transeunte.telefono_cliente, true);
  // Ciudad y zona conservan la regla por subtipo.
  assert.equal(transeunte.ciudad_activacion, false);
  assert.equal(transeunte.zona_activacion, false);
});

test('los cuatro datos del cliente son obligatorios en todos los grupos y subtipos', () => {
  const combinaciones = [
    ['comercio', 'comercio'],
    ['comercio', 'reactivacion_comercio'],
    ['comercio', 'limbo'],
    ['comercio', 'no_habilitado'],
    ['comercio', 'reimpresion_qr'],
    ['tienda_barrio', 'comercio'],
    ['tienda_barrio', 'no_habilitado'],
    ['tienda_barrio', 'reactivacion'],
    ['tienda_barrio', 'config_cuenta'],
    ['tienda_barrio', 'reimpresion_qr'],
    ['transeunte', 'transeunte'],
    ['transeunte', 'reactivacion_transeunte'],
    ['transeunte', 'cliente_antiguo'],
    ['cliente_antiguo', 'cliente_antiguo'],
  ];

  for (const [tipoGrupo, tipoActivacion] of combinaciones) {
    const obligatorios = resolverCamposObligatoriosFormulario({ tipo_grupo: tipoGrupo, tipo_activacion: tipoActivacion });
    for (const { campo } of CAMPOS_DATOS_CLIENTE) {
      assert.equal(obligatorios[campo], true, `${tipoGrupo}/${tipoActivacion} debe exigir ${campo}`);
    }
  }
});

test('resolverCamposClienteFaltantes detecta vacíos, null, undefined y solo espacios', () => {
  assert.deepEqual(
    resolverCamposClienteFaltantes({}).map((item) => item.campo),
    ['nombres_cliente', 'apellidos_cliente', 'ci_cliente', 'telefono_cliente'],
  );
  assert.deepEqual(
    resolverCamposClienteFaltantes({
      nombres_cliente: '   ',
      apellidos_cliente: null,
      ci_cliente: undefined,
      telefono_cliente: '',
    }).map((item) => item.etiqueta),
    ['Nombres', 'Apellidos', 'Cédula de Identidad', 'Teléfono'],
  );
  assert.deepEqual(
    resolverCamposClienteFaltantes({ nombres_cliente: 'Ana', apellidos_cliente: '   ' }).map((item) => item.campo),
    ['apellidos_cliente', 'ci_cliente', 'telefono_cliente'],
  );
  assert.deepEqual(
    resolverCamposClienteFaltantes({
      nombres_cliente: 'Ana',
      apellidos_cliente: 'Quispe',
      ci_cliente: '12345678',
      telefono_cliente: '71234567',
    }),
    [],
  );
});

test('los formatos de CI y teléfono se conservan para datos del cliente', () => {
  assert.equal(esCedulaIdentidadValida('12345678'), true);
  assert.equal(esCedulaIdentidadValida('1234'), false);
  assert.equal(esCedulaIdentidadValida('123456789'), false);
});

test('la descripción de error solo es obligatoria cuando el tipo es Otro', () => {
  assert.equal(resolverCamposObligatoriosFormulario({ hubo_error: true, tipo_error: 'Aplicación' }).descripcion_error, false);
  assert.equal(resolverCamposObligatoriosFormulario({ hubo_error: true, tipo_error: 'Otro' }).descripcion_error, true);
});

test('los botones de fotos solo aparecen con tipo seleccionado y si son obligatorios', () => {
  assert.deepEqual(
    resolverVisibilidadFotografias({ requiereEvidencia: true, requiereCashIn: true }),
    { mostrarEvidencia: false, mostrarCashIn: false },
  );
  assert.deepEqual(
    resolverVisibilidadFotografias({
      tipoGrupo: 'comercio',
      tipoActivacion: 'no_habilitado',
      requiereEvidencia: true,
      requiereCashIn: false,
    }),
    { mostrarEvidencia: true, mostrarCashIn: false },
  );
  assert.deepEqual(
    resolverVisibilidadFotografias({
      tipoGrupo: 'transeunte',
      tipoActivacion: 'transeunte',
      requiereEvidencia: false,
      requiereCashIn: true,
    }),
    { mostrarEvidencia: false, mostrarCashIn: true },
  );
  assert.deepEqual(
    resolverVisibilidadFotografias({
      tipoGrupo: 'desconocido',
      tipoActivacion: 'sin_fotos',
      requiereEvidencia: false,
      requiereCashIn: false,
    }),
    { mostrarEvidencia: false, mostrarCashIn: false },
  );
});

test('las 12 reglas fotográficas vigentes producen únicamente los botones obligatorios', () => {
  const { resolverReglaFotografias } = cargarReglasFotografias();
  const casos = [
    ['comercio', 'comercio', true, true],
    ['comercio', 'reactivacion_comercio', true, true],
    ['comercio', 'limbo', true, true],
    ['comercio', 'no_habilitado', true, false],
    ['comercio', 'reimpresion_qr', true, true],
    ['tienda_barrio', 'comercio', true, true],
    ['tienda_barrio', 'no_habilitado', true, false],
    ['tienda_barrio', 'reactivacion', true, true],
    ['tienda_barrio', 'config_cuenta', true, true],
    ['tienda_barrio', 'reimpresion_qr', true, true],
    ['transeunte', 'transeunte', false, true],
    ['transeunte', 'reactivacion_transeunte', false, true],
  ];

  for (const [tipoGrupo, tipoActivacion, evidencia, cashIn] of casos) {
    const regla = resolverReglaFotografias(tipoGrupo, tipoActivacion);
    assert.deepEqual(regla, {
      requiereEvidencia: evidencia,
      evidenciaOpcional: false,
      requiereCashIn: cashIn,
    });
    assert.deepEqual(
      resolverVisibilidadFotografias({
        tipoGrupo,
        tipoActivacion,
        requiereEvidencia: regla.requiereEvidencia,
        requiereCashIn: regla.requiereCashIn,
      }),
      { mostrarEvidencia: evidencia, mostrarCashIn: cashIn },
    );
  }
});

test('cliente antiguo (transeunte) usa evidencia opcional y sin Cash-In', () => {
  const { resolverReglaFotografias } = cargarReglasFotografias();
  const regla = resolverReglaFotografias('transeunte', 'cliente_antiguo');
  assert.deepEqual(regla, {
    requiereEvidencia: false,
    evidenciaOpcional: true,
    requiereCashIn: false,
  });

  const obligatorios = resolverCamposObligatoriosFormulario({
    tipo_grupo: 'transeunte',
    tipo_activacion: 'cliente_antiguo',
  });
  assert.equal(obligatorios.nombres_cliente, true);
  assert.equal(obligatorios.apellidos_cliente, true);
  assert.equal(obligatorios.ci_cliente, true);
  assert.equal(obligatorios.telefono_cliente, true);
  assert.equal(obligatorios.ciudad_activacion, false);
  assert.equal(obligatorios.zona_activacion, false);
});

test('cliente antiguo como categoría principal conserva reglas y compatibilidad', () => {
  const { resolverReglaFotografias } = cargarReglasFotografias();
  const principal = resolverReglaFotografias('cliente_antiguo', 'cliente_antiguo');
  assert.deepEqual(principal, {
    requiereEvidencia: false,
    evidenciaOpcional: true,
    requiereCashIn: false,
  });

  const obligatorios = resolverCamposObligatoriosFormulario({
    tipo_grupo: 'cliente_antiguo',
    tipo_activacion: 'cliente_antiguo',
  });
  assert.equal(obligatorios.nombres_cliente, true);
  assert.equal(obligatorios.apellidos_cliente, true);
  assert.equal(obligatorios.ci_cliente, true);
  assert.equal(obligatorios.telefono_cliente, true);
  assert.equal(obligatorios.ciudad_activacion, false);
  assert.equal(obligatorios.zona_activacion, false);
  assert.equal(obligatorios.tamano_tienda, false);
  assert.equal(obligatorios.rubro_comercio, false);
});

test('las entradas históricas sin nuevas propiedades siguen resolviendo igual', () => {
  const { resolverReglaFotografias } = cargarReglasFotografias();
  assert.deepEqual(resolverReglaFotografias('transeunte', 'transeunte'), {
    requiereEvidencia: false,
    evidenciaOpcional: false,
    requiereCashIn: true,
  });
  assert.equal(resolverCamposObligatoriosFormulario({}).ciudad_activacion, false);
  assert.equal(resolverCamposObligatoriosFormulario({}).nombres_cliente, true);
});
