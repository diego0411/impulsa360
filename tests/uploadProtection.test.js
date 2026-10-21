const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const uploadFile = path.resolve('lib/upload.js');
const baseDir = 'file:///documents/activaciones-pendientes';
const sourceUri = `${baseDir}/evidencia.jpg`;
const repairedUri = `${baseDir}/evidencia-reparada.jpg`;
const storagePath = 'activaciones/usuario-1/registro-1/principal.jpg';
const otherStoragePath = 'activaciones/usuario-1/registro-1/cash-in.jpg';
const MSG_RESERVA_OCUPADA = 'La subida anterior al mismo destino sigue en curso. Intenta nuevamente.';
const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0x00, 0xFF, 0xD9]);

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const loadUpload = ({
  rejectCancelGrace = false,
  rejectReserva = false,
  rejectManipulate = false,
  imageManipulator,
  sharedFiles,
} = {}) => {
  const files = sharedFiles || new Map([[sourceUri, {
    bytes: jpegBytes,
    modificationTime: 1,
  }]]);
  const deleted = [];
  const tasks = [];

  const fileSystem = {
    documentDirectory: 'file:///documents/',
    cacheDirectory: 'file:///cache/',
    EncodingType: { Base64: 'base64' },
    FileSystemUploadType: { BINARY_CONTENT: 0 },
    createUploadTask(url, taskSourceUri, options) {
      const native = deferred();
      const task = {
        native,
        url,
        sourceUri: taskSourceUri,
        options,
        cancelCalls: 0,
        uploadCalls: 0,
        uploadAsync() {
          this.uploadCalls += 1;
          return native.promise;
        },
        async cancelAsync() {
          this.cancelCalls += 1;
        },
      };
      tasks.push(task);
      return task;
    },
    async getInfoAsync(uri) {
      if (uri === baseDir) return { exists: true, isDirectory: true };
      const file = files.get(uri);
      return file
        ? { exists: true, isDirectory: false, size: file.bytes.length, modificationTime: file.modificationTime }
        : { exists: false };
    },
    async readDirectoryAsync(uri) {
      if (uri !== baseDir) return [];
      return [...files.keys()]
        .filter((fileUri) => fileUri.startsWith(`${baseDir}/`))
        .map((fileUri) => fileUri.slice(baseDir.length + 1));
    },
    async readAsStringAsync(uri, options = {}) {
      const file = files.get(uri);
      if (!file) throw new Error('archivo ausente');
      const start = Number(options.position || 0);
      const end = Number.isFinite(options.length) ? start + options.length : file.bytes.length;
      return file.bytes.subarray(start, end).toString('base64');
    },
    async deleteAsync(uri) {
      deleted.push(uri);
      files.delete(uri);
    },
    async copyAsync({ from, to }) {
      const source = files.get(from);
      if (!source) throw new Error('archivo ausente');
      files.set(to, { ...source, bytes: Buffer.from(source.bytes) });
    },
    async makeDirectoryAsync() {},
  };

  class TimeoutError extends Error {
    constructor(message) {
      super(message);
      this.name = 'TimeoutError';
    }
  }
  const withTimeout = async (promise, _ms, message) => {
    if (rejectCancelGrace && message === 'La cancelación de la subida tardó demasiado.') {
      throw new TimeoutError(message);
    }
    if (rejectReserva && message === MSG_RESERVA_OCUPADA) {
      throw new TimeoutError(message);
    }
    if (rejectManipulate && message === 'No se pudo procesar la imagen.') {
      throw new TimeoutError(message);
    }
    return promise;
  };

  const source = fs.readFileSync(uploadFile, 'utf8');
  const transformed = babel.transformSync(source, {
    filename: uploadFile,
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  }).code;
  const compiled = new Module(uploadFile, module);
  compiled.filename = uploadFile;
  compiled.paths = Module._nodeModulePaths(path.dirname(uploadFile));
  compiled.require = (request) => {
    if (request === './supabase') {
      return {
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: { access_token: 'token-prueba' } }, error: null }),
          },
          storage: { from: () => ({}) },
        },
      };
    }
    if (request === 'expo-file-system/legacy') return fileSystem;
    if (request === 'expo-image-manipulator') return imageManipulator || {};
    if (request === 'react-native') return { Image: {} };
    if (request === 'base64-arraybuffer') {
      return { decode: (value) => Uint8Array.from(Buffer.from(value, 'base64')).buffer };
    }
    if (request === './asyncTimeout') return { TimeoutError, withTimeout };
    if (request === 'uuid') return { v4: () => '00000000-0000-4000-8000-000000000001' };
    if (request === './photoDiagnostics') {
      return {
        crearCodigoErrorFoto: () => 'FOTO-TEST',
        crearIdProcesamientoFoto: () => 'proceso-test',
        registrarErrorFoto: async () => {},
        registrarHitoProcesamientoFoto: async () => {},
      };
    }
    if (request === './telemetry') {
      return { recordPhotoDiagnostic: async () => {} };
    }
    if (request === './config') {
      return { SUPABASE_KEY: 'anon-prueba', SUPABASE_URL: 'https://proyecto.supabase.co' };
    }
    return Module.prototype.require.call(compiled, request);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    compiled._compile(transformed, uploadFile);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }

  return { upload: compiled.exports, files, deleted, tasks };
};

const esperarTareas = async (tasks, expected = 1) => {
  for (let attempt = 0; attempt < 20 && tasks.length < expected; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(tasks.length, expected);
};

const conTimersMockeados = async (fn) => {
  const timers = new Map();
  let timerId = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, ms) => {
    const id = ++timerId;
    timers.set(id, { callback, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  try {
    return await fn(timers);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
};

// Deja un upload con timeout lógico y su tarea nativa aún pendiente (zombie).
const provocarNativaZombie = async (timers, loadOptions = {}) => {
  const contexto = loadUpload({ rejectCancelGrace: true, ...loadOptions });
  const primera = contexto.upload.subirImagenExclusiva(sourceUri, storagePath).then(
    () => null,
    (error) => error,
  );
  await esperarTareas(contexto.tasks);
  const uploadTimer = [...timers.values()].find((timer) => timer.ms === 45000);
  assert.ok(uploadTimer);
  uploadTimer.callback();
  const timeoutError = await primera;
  assert.match(timeoutError.message, /almacenamiento de fotos/);
  assert.equal(contexto.tasks[0].cancelCalls, 1);
  assert.equal(contexto.upload.isFotoEnProceso(sourceUri), true);
  return contexto;
};

test('timeout de ImageManipulator conserva original y protege la fuente hasta el cierre nativo', async () => {
  const manipulacion = deferred();
  const lateUri = 'file:///cache/manipulada-tardia.jpg';
  const imageManipulator = {
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: () => manipulacion.promise,
  };
  const contexto = loadUpload({ rejectManipulate: true, imageManipulator });
  contexto.files.set(lateUri, { bytes: jpegBytes, modificationTime: 2 });

  const error = await contexto.upload.prepararImagenPersistente(sourceUri, 'foto_url', {
    width: 1280,
    height: 960,
    cleanupSourceAfterNative: true,
    onOriginalPersisted: async (_originalUri, marcarOriginalComoPropio) => {
      marcarOriginalComoPropio();
    },
  }).then(() => null, (caught) => caught);

  assert.ok(error);
  assert.equal(error.photoCode, 'FOTO-TEST', `${error.message} [${Object.keys(error).join(',')}]`);
  assert.equal(contexto.upload.isFotoEnProceso(sourceUri), true);
  assert.equal(await contexto.upload.eliminarFotoTemporalSiLibre(sourceUri), false);
  assert.equal(contexto.files.has(sourceUri), true);
  assert.equal(
    [...contexto.files.keys()].some((uri) => uri.endsWith('-original.jpg')),
    true
  );

  manipulacion.resolve({ uri: lateUri, width: 1280, height: 960 });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(contexto.upload.isFotoEnProceso(sourceUri), false);
  assert.equal(contexto.files.has(sourceUri), false);
  assert.equal(contexto.files.has(lateUri), false);
  assert.equal(
    [...contexto.files.keys()].some((uri) => uri.endsWith('-original.jpg')),
    true
  );
});

test('la limpieza no elimina una foto mientras el upload nativo esta pendiente', async () => {
  const { upload, files, deleted, tasks } = loadUpload();
  const operation = upload.subirImagenExclusiva(sourceUri, storagePath);
  await esperarTareas(tasks);

  assert.equal(upload.isFotoEnProceso(sourceUri), true);
  await upload.limpiarFotosPendientesHuerfanas([]);
  await upload.limpiarFotosHuerfanasSegura({ referencedUris: [], maxAgeMs: 0 });
  assert.equal(files.has(sourceUri), true);
  assert.deepEqual(deleted, []);

  tasks[0].native.resolve({ status: 201, body: '{}' });
  assert.equal(await operation, storagePath);
  assert.equal(upload.isFotoEnProceso(sourceUri), false);
});

test('timeout logico: el reintento espera la nativa y no crea otro escritor', async () => {
  await conTimersMockeados(async (timers) => {
    const { upload, files, tasks } = await provocarNativaZombie(timers);

    const retry = upload.subirImagenExclusiva(sourceUri, storagePath);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(tasks.length, 1);
    await upload.limpiarFotosPendientesHuerfanas([]);
    assert.equal(files.has(sourceUri), true);

    tasks[0].native.resolve({ status: 201, body: '{}' });
    await esperarTareas(tasks, 2);
    assert.equal(upload.isFotoEnProceso(sourceUri), true);

    tasks[1].native.resolve({ status: 201, body: '{}' });
    assert.equal(await retry, storagePath);
    assert.equal(upload.isFotoEnProceso(sourceUri), false);
  });
});

test('la espera vencida rechaza el reintento recuperable sin segundo escritor', async () => {
  await conTimersMockeados(async (timers) => {
    const { upload, files, deleted, tasks } = await provocarNativaZombie(timers, { rejectReserva: true });

    const retryError = await upload.subirImagenExclusiva(sourceUri, storagePath).then(
      () => null,
      (error) => error,
    );
    assert.ok(retryError);
    assert.match(retryError.message, /sigue en curso/);
    assert.equal(retryError.causeName, 'TimeoutError');
    assert.equal(retryError.photoSyncCode, 'FOTO-STORAGE-NETWORK');
    assert.equal(tasks.length, 1);
    assert.equal(files.has(sourceUri), true);
    assert.equal(upload.isFotoEnProceso(sourceUri), true);
    await upload.limpiarFotosPendientesHuerfanas([]);
    assert.equal(files.has(sourceUri), true);
    assert.deepEqual(deleted, []);

    tasks[0].native.resolve({ status: 201, body: '{}' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(upload.isFotoEnProceso(sourceUri), false);
  });
});

test('la reparacion tras timeout no arranca un segundo escritor con contenido nuevo', async () => {
  await conTimersMockeados(async (timers) => {
    const { upload, files, tasks } = await provocarNativaZombie(timers);
    files.set(repairedUri, { bytes: jpegBytes, modificationTime: 1 });

    const reparado = upload.subirImagenExclusiva(repairedUri, storagePath);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(tasks.length, 1);

    tasks[0].native.resolve({ status: 201, body: '{}' });
    await esperarTareas(tasks, 2);
    assert.equal(tasks[1].sourceUri, repairedUri);

    tasks[1].native.resolve({ status: 200, body: '{}' });
    assert.equal(await reparado, storagePath);
  });
});

test('una nativa antigua que falla libera la reserva y el nuevo upload usa tarea propia', async () => {
  await conTimersMockeados(async (timers) => {
    const { upload, tasks } = await provocarNativaZombie(timers);

    tasks[0].native.reject(new Error('cancelacion nativa tardia'));
    const nuevo = upload.subirImagenExclusiva(sourceUri, storagePath);
    await esperarTareas(tasks, 2);
    assert.equal(tasks[1].uploadCalls, 1);

    tasks[1].native.resolve({ status: 201, body: '{}' });
    assert.equal(await nuevo, storagePath);
  });
});

test('un zombie no bloquea otros paths ni autoriza escrituras de una sesion anterior', async () => {
  await conTimersMockeados(async (timers) => {
    const { upload, files, tasks } = await provocarNativaZombie(timers);
    files.set(repairedUri, { bytes: jpegBytes, modificationTime: 1 });

    const otro = upload.subirImagenExclusiva(repairedUri, otherStoragePath);
    await esperarTareas(tasks, 2);
    tasks[1].native.resolve({ status: 201, body: '{}' });
    assert.equal(await otro, otherStoragePath);

    await upload.limpiarFotosPendientesHuerfanas([]);
    assert.equal(files.has(sourceUri), true);

    tasks[0].native.resolve({ status: 201, body: '{}' });
    const nuevoIntento = upload.subirImagenExclusiva(sourceUri, storagePath);
    await esperarTareas(tasks, 3);
    assert.equal(tasks[2].sourceUri, sourceUri);
    tasks[2].native.resolve({ status: 201, body: '{}' });
    assert.equal(await nuevoIntento, storagePath);
    assert.equal(upload.isFotoEnProceso(sourceUri), false);
  });
});

test('dos solicitudes del mismo path comparten una sola operacion', async () => {
  const { upload, tasks } = loadUpload();
  const first = upload.subirImagenExclusiva(sourceUri, storagePath);
  const second = upload.subirImagenExclusiva(sourceUri, storagePath);
  assert.equal(first, second);
  await esperarTareas(tasks);
  assert.equal(tasks[0].uploadCalls, 1);

  tasks[0].native.resolve({ status: 200, body: '{}' });
  assert.equal(await first, storagePath);
  assert.equal(await second, storagePath);
});

test('una foto referenciada por pendiente o borrador nunca se limpia', async () => {
  const { upload, files, deleted } = loadUpload();
  await upload.limpiarFotosPendientesHuerfanas([sourceUri]);
  await upload.limpiarFotosHuerfanasSegura({ referencedUris: [sourceUri], maxAgeMs: 0 });
  assert.equal(files.has(sourceUri), true);
  assert.deepEqual(deleted, []);
});

test('la limpieza de logout respeta la proteccion y libera despues del upload', async () => {
  const { upload, files, tasks } = loadUpload();
  const operation = upload.subirImagenExclusiva(sourceUri, storagePath);
  await esperarTareas(tasks);

  await upload.limpiarFotosPendientesHuerfanas([]);
  assert.equal(files.has(sourceUri), true);

  tasks[0].native.resolve({ status: 201, body: '{}' });
  await operation;
  await upload.limpiarFotosPendientesHuerfanas([]);
  assert.equal(files.has(sourceUri), false);
});

test('un reinicio simulado conserva el archivo persistente', () => {
  const sharedFiles = new Map([[sourceUri, { bytes: jpegBytes, modificationTime: 1 }]]);
  loadUpload({ sharedFiles });
  loadUpload({ sharedFiles });
  assert.equal(sharedFiles.has(sourceUri), true);
});

test('skipManipulation persiste un JPEG reducido sin segunda manipulacion', async () => {
  let manipulateCalls = 0;
  const imageManipulator = {
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: async () => {
      manipulateCalls += 1;
      throw new Error('no deberia manipular');
    },
  };
  const reducidaUri = 'file:///cache/impulsa-downsample-test.jpg';
  const contexto = loadUpload({ imageManipulator });
  contexto.files.set(reducidaUri, { bytes: jpegBytes, modificationTime: 1 });

  const destino = await contexto.upload.prepararImagenPersistente(reducidaUri, 'foto_url', {
    width: 1024,
    height: 768,
    skipManipulation: true,
  });

  assert.equal(manipulateCalls, 0);
  assert.equal(contexto.files.has(destino), true);
  assert.equal(contexto.files.has(reducidaUri), true);
  assert.deepEqual(contexto.files.get(destino).bytes, jpegBytes);
});

test('el flujo de 12 MP o menos conserva manipulateAsync', async () => {
  let manipulateCalls = 0;
  const manipuladaUri = 'file:///cache/manipulada.jpg';
  const imageManipulator = {
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: async () => {
      manipulateCalls += 1;
      return { uri: manipuladaUri, width: 1280, height: 960 };
    },
  };
  const contexto = loadUpload({ imageManipulator });
  contexto.files.set(manipuladaUri, { bytes: jpegBytes, modificationTime: 1 });

  const destino = await contexto.upload.prepararImagenPersistente(sourceUri, 'foto_url', {
    width: 4000,
    height: 3000,
  });

  assert.equal(manipulateCalls, 1);
  assert.equal(contexto.files.has(destino), true);
  assert.equal(contexto.files.has(sourceUri), true);
  assert.equal(contexto.files.has(manipuladaUri), false);
});

test('galeria Android de 12 MP o menos acepta un origen pesado y lo manipula', async () => {
  let manipulateCalls = 0;
  const manipuladaUri = 'file:///cache/manipulada-grande.jpg';
  const imageManipulator = {
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: async () => {
      manipulateCalls += 1;
      return { uri: manipuladaUri, width: 1280, height: 960 };
    },
  };
  const contexto = loadUpload({ imageManipulator });
  contexto.files.set(sourceUri, {
    bytes: Buffer.alloc(6 * 1024 * 1024 + 1, 0xFF),
    modificationTime: 1,
  });
  contexto.files.set(manipuladaUri, { bytes: jpegBytes, modificationTime: 1 });

  const destino = await contexto.upload.prepararImagenPersistente(sourceUri, 'foto_url', {
    width: 4000,
    height: 3000,
    allowLargeSourceBytes: true,
  });

  assert.equal(manipulateCalls, 1);
  assert.equal(contexto.files.has(destino), true);
  assert.equal(contexto.files.has(manipuladaUri), false);
});

test('sin allowLargeSourceBytes un origen mayor a 6 MB se rechaza antes de manipular', async () => {
  let manipulateCalls = 0;
  const imageManipulator = {
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: async () => {
      manipulateCalls += 1;
      return { uri: 'file:///cache/no-deberia.jpg', width: 1280, height: 960 };
    },
  };
  const contexto = loadUpload({ imageManipulator });
  contexto.files.set(sourceUri, {
    bytes: Buffer.alloc(6 * 1024 * 1024 + 1, 0xFF),
    modificationTime: 1,
  });

  const error = await contexto.upload.prepararImagenPersistente(sourceUri, 'foto_url', {
    width: 4000,
    height: 3000,
  }).then(() => null, (caught) => caught);

  assert.ok(error);
  assert.match(error.message, /6 MB/);
  assert.equal(manipulateCalls, 0);
});
