const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const downsamplerFile = path.resolve('lib/galleryImageDownsampler.js');
const sourceUri = 'file:///cache/galeria.jpg';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const withTimeoutReal = (promise, ms, message) => {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => {
      const error = new Error(message);
      error.name = 'TimeoutError';
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) globalThis.clearTimeout(timer);
  });
};

const loadDownsampler = ({ downsample, cancel, withTimeout } = {}) => {
  const deleted = [];
  const native = {
    downsample: downsample || (() => new Promise(() => {})),
    cancel: cancel || (async () => true),
  };
  const source = fs.readFileSync(downsamplerFile, 'utf8');
  const transformed = babel.transformSync(source, {
    filename: downsamplerFile,
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  }).code;
  const compiled = new Module(downsamplerFile, module);
  compiled.filename = downsamplerFile;
  compiled.paths = Module._nodeModulePaths(path.dirname(downsamplerFile));
  compiled.require = (request) => {
    if (request === 'react-native') {
      return {
        NativeModules: { ImpulsaImageDownsampler: native },
        Platform: { OS: 'android' },
      };
    }
    if (request === 'expo-file-system/legacy') {
      return {
        async deleteAsync(uri) {
          deleted.push(uri);
        },
      };
    }
    if (request === './asyncTimeout') {
      return { withTimeout: withTimeout || withTimeoutReal };
    }
    return Module.prototype.require.call(compiled, request);
  };
  compiled._compile(transformed, downsamplerFile);
  return { downsampler: compiled.exports, native, deleted };
};

const esperar = (ms = 0) => new Promise((resolve) => {
  if (ms > 0) globalThis.setTimeout(resolve, ms);
  else setImmediate(resolve);
});

test('el timeout cancela la operación nativa y elimina el resultado tardío', async () => {
  const nativa = deferred();
  const cancelaciones = [];
  let operationId = '';
  const contexto = loadDownsampler({
    downsample: (_uri, _side, _quality, id) => {
      operationId = id;
      return nativa.promise;
    },
    cancel: async (id) => {
      cancelaciones.push(id);
      return true;
    },
  });

  const operacion = contexto.downsampler.reducirImagenGaleria(sourceUri, { timeoutMs: 15 });
  await assert.rejects(operacion, (error) => {
    assert.equal(error.code, 'E_DOWNSAMPLE_TIMEOUT');
    assert.equal(error.photoReason, 'downsample_timeout');
    assert.equal(error.cancelConfirmed, true);
    return true;
  });

  assert.equal(cancelaciones.length, 1);
  assert.equal(cancelaciones[0], operationId);
  assert.ok(operationId.startsWith('downsample-'));

  nativa.resolve({ uri: 'file:///cache/tardia.jpg', width: 512, height: 512 });
  await esperar();
  await esperar();
  assert.ok(contexto.deleted.includes('file:///cache/tardia.jpg'));
});

test('no permite iniciar una segunda reducción mientras la primera sigue activa', async () => {
  const primera = deferred();
  let llamadas = 0;
  const contexto = loadDownsampler({
    downsample: () => {
      llamadas += 1;
      return primera.promise;
    },
  });

  const operacionUno = contexto.downsampler.reducirImagenGaleria(sourceUri);
  const operacionDos = contexto.downsampler.reducirImagenGaleria(sourceUri);

  await assert.rejects(operacionDos, (error) => {
    assert.equal(error.code, 'E_DOWNSAMPLE_BUSY');
    assert.equal(error.photoReason, 'downsample_busy');
    return true;
  });
  assert.equal(llamadas, 1);

  primera.resolve({ uri: 'file:///cache/uno.jpg', width: 512, height: 512 });
  assert.deepEqual(await operacionUno, {
    uri: 'file:///cache/uno.jpg',
    width: 512,
    height: 512,
  });
});

test('distingue error de lectura/formato y error de procesamiento nativo', async () => {
  const lectura = loadDownsampler({
    downsample: async () => {
      const error = new Error('lectura');
      error.code = 'E_DOWNSAMPLE_READ';
      throw error;
    },
  });
  await assert.rejects(lectura.downsampler.reducirImagenGaleria(sourceUri), (error) => {
    assert.equal(error.code, 'E_DOWNSAMPLE_READ');
    assert.equal(error.photoReason, 'downsample_read');
    assert.match(error.message, /leer o decodificar/);
    return true;
  });

  const proceso = loadDownsampler({
    downsample: async () => {
      const error = new Error('proceso');
      error.code = 'E_DOWNSAMPLE_PROCESS';
      throw error;
    },
  });
  await assert.rejects(proceso.downsampler.reducirImagenGaleria(sourceUri), (error) => {
    assert.equal(error.code, 'E_DOWNSAMPLE_PROCESS');
    assert.equal(error.photoReason, 'downsample_process');
    assert.match(error.message, /procesar la imagen/);
    return true;
  });
});

test('mantiene la exclusión mientras se confirma la cancelación nativa', async () => {
  const cancelacion = deferred();
  const tercera = deferred();
  let llamadas = 0;
  let cancelaciones = 0;
  const contexto = loadDownsampler({
    downsample: () => {
      llamadas += 1;
      return llamadas === 1 ? new Promise(() => {}) : tercera.promise;
    },
    cancel: () => {
      cancelaciones += 1;
      return cancelacion.promise;
    },
  });

  const primera = contexto.downsampler.reducirImagenGaleria(sourceUri, { timeoutMs: 10 });
  for (let intento = 0; intento < 50 && cancelaciones === 0; intento += 1) {
    await esperar(1);
  }
  assert.equal(cancelaciones, 1);

  await assert.rejects(
    contexto.downsampler.reducirImagenGaleria(sourceUri),
    (error) => error.code === 'E_DOWNSAMPLE_BUSY'
  );
  assert.equal(llamadas, 1);

  cancelacion.resolve(true);
  await assert.rejects(primera, (error) => error.code === 'E_DOWNSAMPLE_TIMEOUT');

  const nueva = contexto.downsampler.reducirImagenGaleria(sourceUri);
  tercera.resolve({ uri: 'file:///cache/nueva.jpg', width: 300, height: 300 });
  assert.deepEqual(await nueva, {
    uri: 'file:///cache/nueva.jpg',
    width: 300,
    height: 300,
  });
});

test('después de cancelar por timeout se puede iniciar una nueva reducción', async () => {
  let primeraLlamada = true;
  const segunda = deferred();
  const contexto = loadDownsampler({
    downsample: () => {
      if (primeraLlamada) {
        primeraLlamada = false;
        return new Promise(() => {});
      }
      return segunda.promise;
    },
    cancel: async () => true,
  });

  await assert.rejects(
    contexto.downsampler.reducirImagenGaleria(sourceUri, { timeoutMs: 10 }),
    (error) => error.code === 'E_DOWNSAMPLE_TIMEOUT'
  );

  const operacion = contexto.downsampler.reducirImagenGaleria(sourceUri);
  segunda.resolve({ uri: 'file:///cache/recuperada.jpg', width: 400, height: 400 });
  assert.deepEqual(await operacion, {
    uri: 'file:///cache/recuperada.jpg',
    width: 400,
    height: 400,
  });
});

test('si la cancelación no se confirma, el error de timeout lo informa', async () => {
  const contexto = loadDownsampler({
    downsample: () => new Promise(() => {}),
    cancel: async () => false,
  });

  await assert.rejects(
    contexto.downsampler.reducirImagenGaleria(sourceUri, { timeoutMs: 10 }),
    (error) => {
      assert.equal(error.code, 'E_DOWNSAMPLE_TIMEOUT');
      assert.equal(error.cancelConfirmed, false);
      assert.match(error.message, /Espera un momento/);
      return true;
    }
  );
});
