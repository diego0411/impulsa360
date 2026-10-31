const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const filename = path.resolve('lib/plazasTemporales.js');

const cargarModulo = ({ valores = {}, respuesta }) => {
  const storage = new Map(Object.entries(valores));
  const escrituras = [];
  const asyncStorage = {
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => {
      escrituras.push({ key, value });
      storage.set(key, value);
    },
  };
  const supabase = {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        is: async () => respuesta,
      };
      return query;
    },
  };
  const { code } = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  });
  const modulo = new Module(filename, module);
  modulo.filename = filename;
  modulo.paths = Module._nodeModulePaths(path.dirname(filename));
  modulo.require = (request) => {
    if (request === '@react-native-async-storage/async-storage') return { __esModule: true, default: asyncStorage };
    if (request === './supabase') return { supabase };
    if (request === './identity') return { normalizarNombreVisible: (valor) => String(valor || '').trim() };
    if (request === './asyncTimeout') return { withTimeout: (promesa) => promesa };
    if (request === './plazas') {
      return {
        estaPlazaTemporalVigente: (row) => row?.activo !== false && !row?.cancelado_at,
      };
    }
    return Module.prototype.require.call(modulo, request);
  };
  modulo._compile(code, filename);
  return { ...modulo.exports, escrituras, storage };
};

test('una respuesta remota vacía confirma revocación y reemplaza solo la caché del usuario', async () => {
  const cacheUno = JSON.stringify([{ id: 'vieja', nombre: 'La Paz' }]);
  const cacheOtro = JSON.stringify([{ id: 'otra', nombre: 'El Alto' }]);
  const modulo = cargarModulo({
    valores: {
      'plazas_temporales_usuario-1': cacheUno,
      'plazas_temporales_usuario-2': cacheOtro,
    },
    respuesta: { data: [], error: null },
  });

  assert.deepEqual(await modulo.obtenerPlazasTemporales({ activadorId: 'usuario-1', usuarioId: 'usuario-1' }), []);
  assert.equal(modulo.storage.get('plazas_temporales_usuario-1'), '[]');
  assert.equal(modulo.storage.get('plazas_temporales_usuario-2'), cacheOtro);
});

test('un error remoto conserva las últimas temporales confirmadas del mismo usuario', async () => {
  const cache = JSON.stringify([{ id: 'vigente', nombre: 'La Paz' }]);
  const modulo = cargarModulo({
    valores: { 'plazas_temporales_usuario-1': cache },
    respuesta: { data: null, error: { message: 'sin red' } },
  });

  assert.deepEqual(
    await modulo.obtenerPlazasTemporales({ activadorId: 'usuario-1', usuarioId: 'usuario-1' }),
    [{ id: 'vigente', nombre: 'La Paz' }],
  );
  assert.equal(modulo.escrituras.length, 0);
});
