const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const diagnosticsFile = path.resolve('lib/photoDiagnostics.js');

const loadDiagnostics = () => {
  const values = new Map();
  const asyncStorage = {
    values,
    async getItem(key) { return values.has(key) ? values.get(key) : null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
  const source = fs.readFileSync(diagnosticsFile, 'utf8');
  const transformed = babel.transformSync(source, {
    filename: diagnosticsFile,
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  }).code;
  const compiled = new Module(diagnosticsFile, module);
  compiled.filename = diagnosticsFile;
  compiled.paths = Module._nodeModulePaths(path.dirname(diagnosticsFile));
  compiled.require = (request) => {
    if (request === '@react-native-async-storage/async-storage') return asyncStorage;
    if (request === 'react-native') return { Platform: { OS: 'android', Version: 35 } };
    if (request === './asyncTimeout') {
      return {
        isTimeoutError: (error) => error?.name === 'TimeoutError',
        withTimeout: (promise) => promise,
      };
    }
    return Module.prototype.require.call(compiled, request);
  };
  compiled._compile(transformed, diagnosticsFile);
  return { ...compiled.exports, storage: asyncStorage };
};

test('recupera el último hito de una cámara interrumpida', async () => {
  const diagnostics = loadDiagnostics();
  await diagnostics.registrarHitoCamara('cam-1', 'PREVIEW_START', { dimensionBucket: '8_12MP' });

  const recovered = await diagnostics.consumirUltimoHitoCamara();
  assert.equal(recovered.cameraId, 'cam-1');
  assert.equal(recovered.stage, 'PREVIEW_START');
  assert.equal(recovered.status, 'in_progress');
  assert.equal(recovered.dimensionBucket, '8_12MP');
  assert.equal(await diagnostics.consumirUltimoHitoCamara(), null);
});

test('una cámara cerrada o entregada no genera previous_incomplete', async () => {
  const diagnostics = loadDiagnostics();
  await diagnostics.registrarHitoCamara('cam-2', 'CONFIRM_START');
  await diagnostics.finalizarHitoCamara('cam-2', 'PROCESSING_STARTED');

  assert.equal(await diagnostics.consumirUltimoHitoCamara(), null);
});

test('conserva el motivo de rechazo de captura y su recuperación posterior', async () => {
  const diagnostics = loadDiagnostics();
  await diagnostics.registrarHitoCamara('cam-3', 'CAPTURE_DIM_UNKNOWN', { dimensionBucket: 'UNKNOWN' });
  await diagnostics.registrarHitoCamara('cam-3', 'CAPTURE_REJECTED', { dimensionBucket: 'UNKNOWN' });

  const rechazo = await diagnostics.consumirUltimoHitoCamara();
  assert.equal(rechazo.cameraId, 'cam-3');
  assert.equal(rechazo.stage, 'CAPTURE_REJECTED');
  assert.equal(rechazo.status, 'in_progress');
  assert.equal(rechazo.dimensionBucket, 'UNKNOWN');

  await diagnostics.registrarHitoCamara('cam-3', 'CAMERA_MOUNTED');
  const recuperacion = await diagnostics.consumirUltimoHitoCamara();
  assert.equal(recuperacion.cameraId, 'cam-3');
  assert.equal(recuperacion.stage, 'CAMERA_MOUNTED');
  assert.equal(recuperacion.dimensionBucket, undefined);
});

test('los cierres normales de cámara permanecen terminales e idempotentes', async () => {
  const diagnostics = loadDiagnostics();
  await diagnostics.registrarHitoCamara('cam-10', 'CONFIRM_START');
  await diagnostics.finalizarHitoCamara('cam-10', 'CLOSED');
  await diagnostics.finalizarHitoCamara('cam-10', 'SESSION_CLOSED');

  const crudo = JSON.parse(diagnostics.storage.values.get('ultimo_hito_camara_v1'));
  assert.equal(crudo.status, 'completed');
  assert.equal(crudo.stage, 'CLOSED');
  assert.equal(await diagnostics.consumirUltimoHitoCamara(), null);
  assert.equal(await diagnostics.leerUltimoHitoCamara(), null);
});

test('marcar reported es idempotente y no vuelve a quedar reportable', async () => {
  const diagnostics = loadDiagnostics();
  await diagnostics.registrarHitoCamara('cam-11', 'PREVIEW_START');

  const marcado = await diagnostics.marcarHitoReportadoCamara('cam-11');
  assert.equal(marcado.status, 'reported');
  assert.equal(await diagnostics.marcarHitoReportadoCamara('cam-11'), null);
  assert.equal(await diagnostics.marcarHitoReportadoCamara('cam-otra'), null);
  assert.equal(await diagnostics.leerUltimoHitoCamara(), null);
  assert.equal(JSON.parse(diagnostics.storage.values.get('ultimo_hito_camara_v1')).status, 'reported');
  assert.equal(await diagnostics.consumirUltimoHitoCamara(), null);
});

test('el desmontaje inesperado deja el hito como UNMOUNTED reportable, no como cierre', async () => {
  const diagnostics = loadDiagnostics();
  await diagnostics.registrarHitoCamara('cam-12', 'CAPTURE_START');

  const interrumpido = await diagnostics.marcarHitoCamaraInterrumpido('cam-12');
  assert.equal(interrumpido.stage, 'UNMOUNTED');
  assert.equal(interrumpido.status, 'in_progress');
  const reportable = await diagnostics.leerUltimoHitoCamara();
  assert.equal(reportable.cameraId, 'cam-12');
  assert.equal(reportable.stage, 'UNMOUNTED');
  assert.equal(reportable.status, 'in_progress');

  assert.equal(await diagnostics.marcarHitoCamaraInterrumpido('cam-otra'), null);
  await diagnostics.finalizarHitoCamara('cam-12', 'CLOSED');
  assert.equal(await diagnostics.marcarHitoCamaraInterrumpido('cam-12'), null);
  assert.equal(await diagnostics.leerUltimoHitoCamara(), null);
});

test('el cierre de proceso de foto es terminal e idempotente', async () => {
  const diagnostics = loadDiagnostics();
  await diagnostics.registrarHitoProcesamientoFoto('foto-1', 'PREP_START');

  const ok = await diagnostics.finalizarHitoProcesamientoFoto('foto-1', 'completed');
  assert.equal(ok.status, 'completed');
  assert.equal(await diagnostics.finalizarHitoProcesamientoFoto('foto-1', 'error'), null);

  const crudo = JSON.parse(diagnostics.storage.values.get('ultimo_hito_procesamiento_foto_v1'));
  assert.equal(crudo.status, 'completed');
  assert.equal(await diagnostics.leerUltimoHitoProcesamientoFoto(), null);
});

test('libera processId ajeno atascado después de 15 minutos sin pisar procesos frescos', async () => {
  const diagnostics = loadDiagnostics();
  const clave = 'ultimo_hito_procesamiento_foto_v1';

  diagnostics.storage.values.set(clave, JSON.stringify({
    processId: 'foto_atascado',
    status: 'in_progress',
    stage: 'PREP_START',
    timestamp: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    platform: 'android',
    platformVersion: '35',
  }));
  const nuevo = await diagnostics.registrarHitoProcesamientoFoto('foto_nuevo', 'PREP_START');
  assert.equal(nuevo.processId, 'foto_nuevo');
  assert.equal(JSON.parse(diagnostics.storage.values.get(clave)).processId, 'foto_nuevo');

  diagnostics.storage.values.set(clave, JSON.stringify({
    processId: 'foto_activo',
    status: 'in_progress',
    stage: 'PREP_START',
    timestamp: new Date().toISOString(),
    platform: 'android',
    platformVersion: '35',
  }));
  assert.equal(await diagnostics.registrarHitoProcesamientoFoto('foto_intruso', 'PREP_START'), null);
  const mismo = await diagnostics.registrarHitoProcesamientoFoto('foto_activo', 'DIMENSIONS_OK');
  assert.equal(mismo.processId, 'foto_activo');
  assert.equal(JSON.parse(diagnostics.storage.values.get(clave)).processId, 'foto_activo');
});

test('marcar foto reportada es idempotente y deja de ser reportable', async () => {
  const diagnostics = loadDiagnostics();
  await diagnostics.registrarHitoProcesamientoFoto('foto-2', 'PREP_START');

  const marcado = await diagnostics.marcarHitoReportadoProcesamientoFoto('foto-2');
  assert.equal(marcado.status, 'reported');
  assert.equal(await diagnostics.marcarHitoReportadoProcesamientoFoto('foto-2'), null);
  assert.equal(await diagnostics.leerUltimoHitoProcesamientoFoto(), null);
  assert.equal(await diagnostics.consumirUltimoHitoProcesamientoFoto(), null);
});
