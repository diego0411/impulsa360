const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const {
  construirPayloadSincronizacionActivacion,
  resolverProductosGuardados,
} = require('../lib/activationRecord');

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
  assert.equal(guardados[0].id, id);
});

test('storage preserva UUID válido y conserva ID legacy inválido para reparación', async () => {
  const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { storage, persisted } = loadStorage({ initial: { [STORAGE_KEY]: '[]' } });

  await storage.guardarFormularioLocal({
    usuario_id: 'usuario-1',
    id: uuid,
    nombres_cliente: 'Valido',
  });
  await storage.guardarFormularioLocal({
    usuario_id: 'usuario-1',
    id: 'identificador-legacy-largo-invalido',
    nombres_cliente: 'Legacy',
  });

  const guardados = JSON.parse(persisted.get(STORAGE_KEY));
  assert.equal(guardados.find((item) => item.nombres_cliente === 'Valido').id, uuid);
  assert.equal(
    guardados.find((item) => item.nombres_cliente === 'Legacy').id,
    'identificador-legacy-largo-invalido',
  );
});

test('Remesa conserva su booleano desde guardado elegible hasta el payload de sincronización', async () => {
  const casos = [
    {
      nombre: 'elegible true',
      tipo_grupo: 'tienda_barrio',
      tipo_activacion: 'comercio',
      seleccion: true,
      esperado: true,
    },
    {
      nombre: 'elegible false',
      tipo_grupo: 'tienda_barrio',
      tipo_activacion: 'comercio',
      seleccion: false,
      esperado: false,
    },
    {
      nombre: 'no elegible true',
      tipo_grupo: 'comercio',
      tipo_activacion: 'reactivacion_comercio',
      seleccion: true,
      esperado: false,
    },
  ];

  for (const [index, caso] of casos.entries()) {
    const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const { storage } = loadStorage({ initial: { [STORAGE_KEY]: '[]' } });
    const formulario = {
      id,
      usuario_id: 'usuario-1',
      tipo_grupo: caso.tipo_grupo,
      tipo_activacion: caso.tipo_activacion,
      base_activacion: caso.tipo_grupo,
      remesas: caso.seleccion,
    };
    const registro = {
      ...formulario,
      ...resolverProductosGuardados(formulario),
    };

    await storage.guardarFormularioLocal(registro);
    const lectura = await storage.leerFormulariosLocalesSeguro();
    assert.equal(lectura.status, 'ok', caso.nombre);
    assert.equal(lectura.value.length, 1, caso.nombre);
    const offline = lectura.value[0];
    assert.equal(offline.remesas, caso.esperado, caso.nombre);
    assert.equal(offline.id, id, `${caso.nombre}: UUID offline estable`);

    const payload = construirPayloadSincronizacionActivacion(offline);
    assert.equal(payload.remesas, caso.esperado, caso.nombre);
    assert.equal(typeof payload.remesas, 'boolean', caso.nombre);
    assert.equal(payload.id, id, `${caso.nombre}: UUID del payload estable`);
  }
});

test('datos legacy validos migran sin cambiar registros existentes', async () => {
  const legacy = JSON.stringify(pendientesIniciales());
  const { storage, persisted } = loadStorage({ initial: { [LEGACY_KEY]: legacy } });

  const guardados = await storage.obtenerFormulariosLocales();
  assert.equal(guardados.length, 2);
  assert.equal(JSON.parse(persisted.get(STORAGE_KEY)).length, 2);
  assert.equal(persisted.get(LEGACY_KEY), legacy);
});

test('migración legacy conserva un ID explícito inválido y crea identidad local separada', async () => {
  const legacyId = 'identificador-legacy-largo-invalido';
  const legacy = JSON.stringify([{
    id: legacyId,
    usuario_id: 'usuario-1',
    foto_url: 'file:///foto-pendiente.jpg',
  }]);
  const { storage } = loadStorage({ initial: { [LEGACY_KEY]: legacy } });

  const [migrado] = await storage.obtenerFormulariosLocales();
  assert.equal(migrado.id, legacyId);
  assert.match(migrado._id_local, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(migrado.foto_url, 'file:///foto-pendiente.jpg');
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
