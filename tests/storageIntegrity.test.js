const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const STORAGE_KEY = 'formularios_offline_v1';
const LEGACY_KEY = 'formularios_locales';
const storageFile = path.resolve('lib/storage.js');

const loadStorage = ({ initial = {}, failWrites = false } = {}) => {
  const persisted = new Map(Object.entries(initial));
  const writes = [];
  let uuidSequence = 0;

  const secureLocalStorage = {
    async getItem(key) {
      return persisted.has(key) ? persisted.get(key) : null;
    },
    async setItem(key, value) {
      if (failWrites) throw new Error('fallo durable simulado');
      writes.push({ key, value });
      persisted.set(key, value);
      return true;
    },
    async removeItem(key) {
      persisted.delete(key);
      return true;
    },
  };
  const leerRegistroSeguro = async (key) => (
    persisted.has(key)
      ? { status: 'ok', value: persisted.get(key), legacy: true }
      : { status: 'absent', value: null }
  );

  const source = fs.readFileSync(storageFile, 'utf8');
  const transformed = babel.transformSync(source, {
    filename: storageFile,
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  }).code;
  const compiled = new Module(storageFile, module);
  compiled.filename = storageFile;
  compiled.paths = Module._nodeModulePaths(path.dirname(storageFile));
  compiled.require = (request) => {
    if (request === 'react-native') return { Platform: { OS: 'android' } };
    if (request === 'uuid') {
      return { v4: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}` };
    }
    if (request === './secureLocalStorage') return { leerRegistroSeguro, secureLocalStorage };
    return Module.prototype.require.call(compiled, request);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    compiled._compile(transformed, storageFile);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }

  return {
    storage: compiled.exports,
    persisted,
    writes,
  };
};

const pendientesIniciales = () => ([
  { _id_local: 'local-1', usuario_id: 'usuario-1', nombres_cliente: 'Uno' },
  { _id_local: 'local-2', usuario_id: 'usuario-1', nombres_cliente: 'Dos' },
]);

test('un registro circular no vacia dos pendientes existentes', async () => {
  const original = JSON.stringify(pendientesIniciales());
  const { storage, persisted, writes } = loadStorage({ initial: { [STORAGE_KEY]: original } });
  const circular = {};
  circular.self = circular;

  await assert.rejects(
    storage.guardarFormularioLocal({ usuario_id: 'usuario-1', valor: circular }),
    /serializar los pendientes locales/,
  );
  assert.equal(persisted.get(STORAGE_KEY), original);
  assert.equal(writes.length, 0);
});

test('JSON invalido impide guardar y conserva el valor anterior', async () => {
  const original = '{json-invalido';
  const { storage, persisted, writes } = loadStorage({ initial: { [STORAGE_KEY]: original } });

  await assert.rejects(
    storage.guardarFormularioLocal({ usuario_id: 'usuario-1' }),
    /JSON inválido/,
  );
  assert.equal(persisted.get(STORAGE_KEY), original);
  assert.equal(writes.length, 0);
});

test('JSON invalido impide eliminar y conserva el valor anterior', async () => {
  const original = '{json-invalido';
  const { storage, persisted, writes } = loadStorage({ initial: { [STORAGE_KEY]: original } });

  await assert.rejects(storage.eliminarFormularioLocal('local-1'), /JSON inválido/);
  assert.equal(persisted.get(STORAGE_KEY), original);
  assert.equal(writes.length, 0);
});

test('BigInt no serializable no modifica pendientes existentes', async () => {
  const original = JSON.stringify(pendientesIniciales());
  const { storage, persisted, writes } = loadStorage({ initial: { [STORAGE_KEY]: original } });

  await assert.rejects(
    storage.guardarFormularioLocal({ usuario_id: 'usuario-1', valor: 1n }),
    /serializar los pendientes locales/,
  );
  assert.equal(persisted.get(STORAGE_KEY), original);
  assert.equal(writes.length, 0);
});

test('un array vacio valido admite guardar normalmente', async () => {
  const { storage, persisted } = loadStorage({ initial: { [STORAGE_KEY]: '[]' } });

  const id = await storage.guardarFormularioLocal({ usuario_id: 'usuario-1', nombres_cliente: 'Nuevo' });
  const guardados = JSON.parse(persisted.get(STORAGE_KEY));
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0]._id_local, id);
  assert.equal(guardados[0].usuario_id, 'usuario-1');
});

test('datos legacy validos migran sin cambiar registros existentes', async () => {
  const legacy = JSON.stringify(pendientesIniciales());
  const { storage, persisted } = loadStorage({ initial: { [LEGACY_KEY]: legacy } });

  const guardados = await storage.obtenerFormulariosLocales();
  assert.equal(guardados.length, 2);
  assert.equal(JSON.parse(persisted.get(STORAGE_KEY)).length, 2);
  assert.equal(persisted.get(LEGACY_KEY), legacy);
});

test('legacy invalido no crea almacenamiento nuevo ni altera el original', async () => {
  const legacy = '{legacy-invalido';
  const { storage, persisted, writes } = loadStorage({ initial: { [LEGACY_KEY]: legacy } });

  await assert.rejects(
    storage.guardarFormularioLocal({ usuario_id: 'usuario-1' }),
    /legacy con JSON inválido/,
  );
  assert.equal(persisted.has(STORAGE_KEY), false);
  assert.equal(persisted.get(LEGACY_KEY), legacy);
  assert.equal(writes.length, 0);
});

test('un error de escritura no confirma ni modifica el valor persistido', async () => {
  const original = JSON.stringify(pendientesIniciales());
  const { storage, persisted } = loadStorage({
    initial: { [STORAGE_KEY]: original },
    failWrites: true,
  });

  await assert.rejects(
    storage.guardarFormularioLocal({ usuario_id: 'usuario-1' }),
    /fallo durable simulado/,
  );
  assert.equal(persisted.get(STORAGE_KEY), original);
});
