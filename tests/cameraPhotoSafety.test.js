const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const helperFile = path.resolve('lib/cameraPhotoSafety.js');

const cargarHelper = () => {
  const source = fs.readFileSync(helperFile, 'utf8');
  const transformed = babel.transformSync(source, {
    filename: helperFile,
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  }).code;
  const compiled = new Module(helperFile, module);
  compiled.filename = helperFile;
  compiled.paths = Module._nodeModulePaths(path.dirname(helperFile));
  compiled._compile(transformed, helperFile);
  return compiled.exports;
};

const {
  evaluarDimensionesCaptura,
  seleccionarPictureSizeSeguro,
} = cargarHelper();

test('selecciona únicamente un pictureSize soportado de hasta 12 MP', () => {
  assert.deepEqual(
    seleccionarPictureSizeSeguro(['8000x6000', '4000x3000', '1280x960']),
    { status: 'supported', size: '1280x960' }
  );
  assert.deepEqual(
    seleccionarPictureSizeSeguro(['5000x4000', '4000x3500']),
    { status: 'unsupported', size: null }
  );
  assert.deepEqual(
    seleccionarPictureSizeSeguro([]),
    { status: 'unknown', size: '' }
  );
});

test('valida dimensiones antes del preview y usa pictureSize como respaldo', () => {
  assert.equal(evaluarDimensionesCaptura({ width: 4000, height: 3000 }).ok, true);
  assert.deepEqual(
    evaluarDimensionesCaptura({ width: 0, height: 0, pictureSize: '1280x960' }),
    {
      ok: true,
      reason: null,
      width: 1280,
      height: 960,
      pixels: 1228800,
      bucket: 'LE_2MP',
    }
  );
  assert.deepEqual(
    evaluarDimensionesCaptura({ width: 5000, height: 3000 }),
    {
      ok: false,
      reason: 'too_large',
      width: 5000,
      height: 3000,
      pixels: 15000000,
      bucket: 'GT_12MP',
    }
  );
  assert.equal(evaluarDimensionesCaptura({ width: 0, height: Number.NaN }).reason, 'unknown');
});

test('rechaza capturas sin dimensiones verificables ni pictureSize utilizable', () => {
  assert.deepEqual(
    evaluarDimensionesCaptura({ width: undefined, height: undefined, pictureSize: '' }),
    { ok: false, reason: 'unknown', pixels: 0, bucket: 'UNKNOWN' }
  );
  assert.equal(evaluarDimensionesCaptura({ width: undefined, height: undefined }).reason, 'unknown');
  assert.equal(evaluarDimensionesCaptura({}).reason, 'unknown');
  assert.equal(evaluarDimensionesCaptura({ pictureSize: 'no-numerica' }).reason, 'unknown');
});

test('rechaza la resolución por defecto excesiva cuando no hay pictureSize seguro', () => {
  const resultado = evaluarDimensionesCaptura({ width: 4608, height: 3456, pictureSize: '' });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.reason, 'too_large');
  assert.equal(resultado.bucket, 'GT_12MP');
  assert.equal(seleccionarPictureSizeSeguro([]).size, '');
  assert.equal(seleccionarPictureSizeSeguro(['4608x3456']).status, 'unsupported');
});
