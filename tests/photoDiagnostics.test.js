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
  return compiled.exports;
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
