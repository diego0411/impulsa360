const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  asegurarUuidActivacionPersistido,
  clasificarIdActivacion,
  esUuidValido,
} = require('../lib/activationUuid');

const UUID_EXISTENTE = '11111111-1111-4111-8111-111111111111';
const UUID_LOCAL = '22222222-2222-4222-8222-222222222222';
const UUID_GENERADO = '33333333-3333-4333-8333-333333333333';

test('clasifica UUID válido, ID explícito inválido e ID ausente', () => {
  assert.equal(esUuidValido(UUID_EXISTENTE), true);
  assert.equal(clasificarIdActivacion(UUID_EXISTENTE), 'valido');
  assert.equal(clasificarIdActivacion('identificador-legacy-largo-invalido'), 'invalido');
  assert.equal(clasificarIdActivacion(''), 'ausente');
  assert.equal(clasificarIdActivacion(null), 'ausente');
});

test('preserva UUID válido sin escribirlo nuevamente', async () => {
  let escrituras = 0;
  const result = await asegurarUuidActivacionPersistido({
    id: UUID_EXISTENTE,
    idLocal: UUID_LOCAL,
    generarUuid: () => UUID_GENERADO,
    persistir: async () => { escrituras += 1; return true; },
    leerPersistido: async () => ({ id: UUID_EXISTENTE }),
  });
  assert.deepEqual(result, { ok: true, recordId: UUID_EXISTENTE, source: 'existing' });
  assert.equal(escrituras, 0);
});

test('ID explícito inválido se bloquea sin persistir ni regenerar', async () => {
  let generar = 0;
  let persistir = 0;
  const result = await asegurarUuidActivacionPersistido({
    id: 'identificador-legacy-largo-invalido',
    idLocal: UUID_LOCAL,
    generarUuid: () => { generar += 1; return UUID_GENERADO; },
    persistir: async () => { persistir += 1; return true; },
    leerPersistido: async () => null,
  });
  assert.deepEqual(result, { ok: false, reason: 'invalid_id' });
  assert.equal(generar, 0);
  assert.equal(persistir, 0);
});

test('ID ausente reutiliza _id_local UUID y confirma su persistencia', async () => {
  let guardado = null;
  const result = await asegurarUuidActivacionPersistido({
    id: '',
    idLocal: UUID_LOCAL,
    generarUuid: () => UUID_GENERADO,
    persistir: async (id) => { guardado = id; return true; },
    leerPersistido: async () => ({ id: guardado }),
  });
  assert.deepEqual(result, { ok: true, recordId: UUID_LOCAL, source: 'local_id' });
});

test('ID ausente genera UUID si _id_local es legacy y el reintento conserva el persistido', async () => {
  let guardado = null;
  let generaciones = 0;
  const generarUuid = () => { generaciones += 1; return UUID_GENERADO; };
  const first = await asegurarUuidActivacionPersistido({
    id: null,
    idLocal: 'local-legacy',
    generarUuid,
    persistir: async (id) => { guardado = id; return true; },
    leerPersistido: async () => ({ id: guardado }),
  });
  const retry = await asegurarUuidActivacionPersistido({
    id: guardado,
    idLocal: 'local-legacy',
    generarUuid,
    persistir: async () => { throw new Error('no debe escribir'); },
    leerPersistido: async () => null,
  });
  assert.deepEqual(first, { ok: true, recordId: UUID_GENERADO, source: 'generated' });
  assert.deepEqual(retry, { ok: true, recordId: UUID_GENERADO, source: 'existing' });
  assert.equal(generaciones, 1);
});

test('fallo o relectura inconsistente bloquean el avance', async () => {
  const failedWrite = await asegurarUuidActivacionPersistido({
    id: undefined,
    idLocal: UUID_LOCAL,
    generarUuid: () => UUID_GENERADO,
    persistir: async () => false,
    leerPersistido: async () => ({ id: UUID_LOCAL }),
  });
  assert.deepEqual(failedWrite, { ok: false, reason: 'persistence_failed' });

  const inconsistentRead = await asegurarUuidActivacionPersistido({
    id: undefined,
    idLocal: UUID_LOCAL,
    generarUuid: () => UUID_GENERADO,
    persistir: async () => true,
    leerPersistido: async () => ({ id: UUID_EXISTENTE }),
  });
  assert.deepEqual(inconsistentRead, { ok: false, reason: 'persistence_not_confirmed' });
});

test('sincronización confirma UUID antes de RPC, fotografías y upsert', () => {
  const appSource = fs.readFileSync(path.resolve('App.js'), 'utf8');
  const uuidGuard = appSource.indexOf('const uuidResult = await asegurarUuidActivacionPersistido');
  const eligibilityRpc = appSource.indexOf(
    'if (requiereValidacionReactivacion(formulario.tipo_activacion))',
    uuidGuard,
  );
  const photoLoop = appSource.indexOf('for (const key of fotoKeys)', uuidGuard);
  const upsert = appSource.indexOf("supabase.from('activaciones').upsert", uuidGuard);

  assert.ok(uuidGuard >= 0);
  assert.ok(eligibilityRpc > uuidGuard);
  assert.ok(photoLoop > uuidGuard);
  assert.ok(upsert > uuidGuard);
});
