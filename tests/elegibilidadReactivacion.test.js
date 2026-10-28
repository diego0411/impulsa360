const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const transformar = (filename) => {
  const { code } = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  });
  return code;
};

const compilar = (filename) => {
  const modulo = new Module(filename, module);
  modulo.filename = filename;
  modulo.paths = Module._nodeModulePaths(path.dirname(filename));
  modulo._compile(transformar(filename), filename);
  return modulo.exports;
};

const cargarModulo = ({ rpc } = {}) => {
  const filename = path.resolve('lib/elegibilidadReactivacion.js');
  const asyncTimeout = compilar(path.resolve('lib/asyncTimeout.js'));
  const modulo = new Module(filename, module);
  modulo.filename = filename;
  modulo.paths = Module._nodeModulePaths(path.dirname(filename));
  modulo.require = (request) => {
    if (request === './asyncTimeout') return asyncTimeout;
    if (request === './supabase') {
      return {
        supabase: {
          rpc: rpc || (async () => ({ data: null, error: { message: 'rpc de prueba no configurada' } })),
        },
      };
    }
    return Module.prototype.require.call(modulo, request);
  };
  modulo._compile(transformar(filename), filename);
  return { ...modulo.exports, TimeoutError: asyncTimeout.TimeoutError };
};

test('la validación de elegibilidad solo aplica a reactivaciones y reimpresión QR', () => {
  const { requiereValidacionReactivacion } = cargarModulo();
  assert.equal(requiereValidacionReactivacion('reactivacion_transeunte'), true);
  assert.equal(requiereValidacionReactivacion('reactivacion_comercio'), true);
  assert.equal(requiereValidacionReactivacion('reimpresion_qr'), true);
  assert.equal(requiereValidacionReactivacion('comercio'), false);
  assert.equal(requiereValidacionReactivacion('limbo'), false);
  assert.equal(requiereValidacionReactivacion(undefined), false);
});

test('solo timeout y errores de red inequívocos se clasifican como transitorios', () => {
  const { esFalloTransitorioElegibilidad, TimeoutError } = cargarModulo();

  assert.equal(
    esFalloTransitorioElegibilidad(new TimeoutError('La señal está muy débil para validar reactivación.')),
    true,
  );
  assert.equal(esFalloTransitorioElegibilidad(new TypeError('Network request failed')), true);
  assert.equal(esFalloTransitorioElegibilidad({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }), true);
  assert.equal(esFalloTransitorioElegibilidad({ code: 'ETIMEDOUT', message: 'connection timed out' }), true);
  assert.equal(esFalloTransitorioElegibilidad({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), true);
  assert.equal(esFalloTransitorioElegibilidad({ message: 'fetch failed' }), true);
});

test('auth, permisos, configuración y errores de lógica jamás pasan por transitorios', () => {
  const { esFalloTransitorioElegibilidad, TimeoutError } = cargarModulo();

  assert.equal(esFalloTransitorioElegibilidad({ code: 'PGRST301', message: 'JWT expired' }), false);
  assert.equal(esFalloTransitorioElegibilidad({ status: 401, message: 'Unauthorized' }), false);
  assert.equal(
    esFalloTransitorioElegibilidad({ code: '42501', message: 'permission denied for table activaciones' }),
    false,
  );
  assert.equal(esFalloTransitorioElegibilidad({ message: 'Invalid API key' }), false);
  assert.equal(
    esFalloTransitorioElegibilidad({ code: '23505', message: 'duplicate key value violates unique constraint' }),
    false,
  );
  assert.equal(esFalloTransitorioElegibilidad(new Error('algo inesperado')), false);
  assert.equal(esFalloTransitorioElegibilidad(undefined), false);
  assert.equal(esFalloTransitorioElegibilidad(null), false);
  // El nombre TimeoutError debe venir de la clase real, no de un string cualquiera.
  assert.equal(esFalloTransitorioElegibilidad({ name: 'Error', message: 'timeout' }), false);
  assert.equal(new TimeoutError('x').name, 'TimeoutError');
});

test('rechazo explícito de la RPC devuelve ok:false con mensaje de bloqueo', async () => {
  const rpc = async () => ({
    data: [{ eligible: false, previous_activation_date: '2026-07-01' }],
    error: null,
  });
  const { validarElegibilidadReactivacion } = cargarModulo({ rpc });
  const resultado = await validarElegibilidadReactivacion({
    ci: '12345678',
    telefono: '71234567',
    tipoActivacion: 'reactivacion_transeunte',
    registroId: 'registro-1',
    fechaReferencia: '2026-10-21',
  });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.requiereValidacion, true);
  assert.match(resultado.mensaje, /90/);
});

test('la RPC elegible devuelve ok:true', async () => {
  const rpc = async () => ({ data: [{ eligible: true }], error: null });
  const { validarElegibilidadReactivacion } = cargarModulo({ rpc });
  const resultado = await validarElegibilidadReactivacion({
    ci: '12345678',
    telefono: '71234567',
    tipoActivacion: 'reactivacion_comercio',
    registroId: 'registro-2',
    fechaReferencia: '2026-10-21',
  });
  assert.deepEqual(resultado, { ok: true, requiereValidacion: true });
});

test('sin cédula ni teléfono no se consulta la RPC', async () => {
  let rpcCalls = 0;
  const { validarElegibilidadReactivacion } = cargarModulo({
    rpc: async () => {
      rpcCalls += 1;
      return { data: [{ eligible: true }], error: null };
    },
  });
  const resultado = await validarElegibilidadReactivacion({
    ci: '  ',
    telefono: null,
    tipoActivacion: 'reactivacion_transeunte',
  });
  assert.deepEqual(resultado, { ok: true, requiereValidacion: true });
  assert.equal(rpcCalls, 0);
});

test('un error de la RPC se propaga como excepción y nunca como resultado', async () => {
  const authError = { code: 'PGRST301', message: 'JWT expired' };
  const { validarElegibilidadReactivacion, esFalloTransitorioElegibilidad } = cargarModulo({
    rpc: async () => ({ data: null, error: authError }),
  });
  await assert.rejects(
    () => validarElegibilidadReactivacion({
      ci: '12345678',
      telefono: '71234567',
      tipoActivacion: 'reactivacion_transeunte',
    }),
    (error) => error === authError,
  );
  assert.equal(esFalloTransitorioElegibilidad(authError), false);
});

test('timeout y fallo de red de la RPC se propagan y sí se clasifican como transitorios', async () => {
  const { validarElegibilidadReactivacion, esFalloTransitorioElegibilidad, TimeoutError } = cargarModulo({
    rpc: async () => {
      throw new TimeoutError('La señal está muy débil para validar reactivación.');
    },
  });
  await assert.rejects(
    () => validarElegibilidadReactivacion({
      ci: '12345678',
      telefono: '71234567',
      tipoActivacion: 'reimpresion_qr',
    }),
    (error) => error instanceof TimeoutError
      && error.message === 'La señal está muy débil para validar reactivación.',
  );
  assert.equal(esFalloTransitorioElegibilidad(new TimeoutError('La señal está muy débil para validar reactivación.')), true);
  assert.equal(esFalloTransitorioElegibilidad(new TypeError('Network request failed')), true);
});

test('tipos que no requieren validación no tocan la RPC ni el clasificador', async () => {
  let rpcCalls = 0;
  const { validarElegibilidadReactivacion } = cargarModulo({
    rpc: async () => {
      rpcCalls += 1;
      return { data: null, error: null };
    },
  });
  const resultado = await validarElegibilidadReactivacion({ ci: '12345678', tipoActivacion: 'limbo' });
  assert.deepEqual(resultado, { ok: true, requiereValidacion: false });
  assert.equal(rpcCalls, 0);
});
