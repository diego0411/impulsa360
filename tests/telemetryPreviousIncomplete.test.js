const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const EVENT_ID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const transformar = (filename) => {
  const { code } = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  });
  return code;
};

const crearStorage = () => {
  const values = new Map();
  const fallos = new Map();
  const ejecutarFallo = async (op, key) => {
    const id = `${op}:${key}`;
    const restantes = fallos.get(id) || 0;
    if (restantes > 0) {
      fallos.set(id, restantes - 1);
      throw new Error(`fallo forzado: ${op} ${key}`);
    }
  };
  return {
    async getItem(key) {
      await ejecutarFallo('getItem', key);
      return values.has(key) ? values.get(key) : null;
    },
    async setItem(key, value) {
      await ejecutarFallo('setItem', key);
      values.set(key, value);
    },
    async removeItem(key) {
      await ejecutarFallo('removeItem', key);
      values.delete(key);
    },
    registrarFallo(op, key, veces = 1) {
      fallos.set(`${op}:${key}`, veces);
    },
    values,
    setRaw: (key, value) => values.set(key, value),
    getRaw: (key) => (values.has(key) ? values.get(key) : null),
  };
};

const cargarTelemetry = ({ storage, rpc } = {}) => {
  const fotoFile = path.resolve('lib/photoDiagnostics.js');
  const telFile = path.resolve('lib/telemetry.js');

  const foto = new Module(fotoFile, module);
  foto.filename = fotoFile;
  foto.paths = Module._nodeModulePaths(path.dirname(fotoFile));
  foto.require = (request) => {
    if (request === '@react-native-async-storage/async-storage') return storage;
    if (request === 'react-native') return { Platform: { OS: 'android', Version: 35 } };
    if (request === './asyncTimeout') {
      return {
        isTimeoutError: (error) => error?.name === 'TimeoutError',
        withTimeout: (promise) => promise,
      };
    }
    return Module.prototype.require.call(foto, request);
  };
  foto._compile(transformar(fotoFile), fotoFile);

  const tel = new Module(telFile, module);
  tel.filename = telFile;
  tel.paths = Module._nodeModulePaths(path.dirname(telFile));
  tel.require = (request) => {
    if (request === '@react-native-async-storage/async-storage') return storage;
    if (request === 'react-native') return { Platform: { OS: 'android', Version: 35 } };
    if (request === 'expo-constants') {
      return {
        nativeAppVersion: '1.0.30',
        nativeBuildNumber: 82,
        nativeApplicationVersion: '1.0.30',
        nativeApplicationBuildNumber: 82,
        platform: { android: { versionCode: 82 } },
        expoConfig: { version: '1.0.30' },
      };
    }
    if (request === 'expo-application') {
      return { nativeApplicationVersion: '1.0.30', nativeBuildNumber: 82 };
    }
    if (request === './supabase') {
      return {
        supabase: {
          rpc: rpc || (async () => ({ data: null, error: null })),
        },
      };
    }
    if (request === './photoDiagnostics') return foto.exports;
    return Module.prototype.require.call(tel, request);
  };
  tel._compile(transformar(telFile), telFile);
  return tel.exports;
};

const leerOutbox = (storage) => {
  const raw = storage.getRaw('telemetry_outbox_v1');
  return raw ? JSON.parse(raw) : [];
};

const eventosPrevious = (storage) => leerOutbox(storage)
  .filter((e) => e.event_name === 'photo_process_error' && e.error_category === 'previous_incomplete');

const sembrarHitoCamara = (storage, campos) => storage.setRaw(
  'ultimo_hito_camara_v1',
  JSON.stringify({
    status: 'in_progress',
    platform: 'android',
    platformVersion: '35',
    ...campos,
  })
);

const sembrarHitoFoto = (storage, campos) => storage.setRaw(
  'ultimo_hito_procesamiento_foto_v1',
  JSON.stringify({
    status: 'in_progress',
    platform: 'android',
    platformVersion: '35',
    ...campos,
  })
);

const esperarCondicion = async (condicion, ms = 2000) => {
  const inicio = Date.now();
  while (!condicion()) {
    if (Date.now() - inicio > ms) throw new Error('la condición esperada no se cumplió');
    await new Promise((resolver) => globalThis.setTimeout(resolver, 5));
  }
};

test('previous_incomplete se emite una sola vez por marcador y no se reemite', async () => {
  const storage = crearStorage();
  sembrarHitoCamara(storage, { cameraId: 'cam-idem', stage: 'PREVIEW_START', timestamp: new Date().toISOString() });

  const primera = cargarTelemetry({ storage });
  await primera.initTelemetry();

  const eventos = eventosPrevious(storage);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].phase, 'previous_camera');
  assert.equal(eventos[0].screen, 'camera');
  assert.equal(eventos[0].sync_stage, 'PREV_PREVIEW_START');
  assert.equal(eventos[0].event_id, primera.idEventoHito('camara', 'cam-idem'));
  assert.ok(EVENT_ID_REGEX.test(eventos[0].event_id));
  assert.equal(eventos[0].native_exit_reason, undefined);
  assert.equal(eventos[0].exit_timestamp, undefined);
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_camara_v1')).status, 'reported');

  const segunda = cargarTelemetry({ storage });
  await segunda.initTelemetry();

  assert.equal(eventosPrevious(storage).length, 1);
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_camara_v1')).status, 'reported');
  const appStarts = leerOutbox(storage).filter((e) => e.event_name === 'app_start');
  assert.equal(appStarts.length, 2);
});

test('crash entre persistir el evento y marcar reported no duplica el event_id', async () => {
  const storage = crearStorage();
  sembrarHitoCamara(storage, { cameraId: 'cam-crash', stage: 'CAPTURE_START', timestamp: new Date().toISOString() });

  await cargarTelemetry({ storage }).initTelemetry();
  assert.equal(eventosPrevious(storage).length, 1);

  sembrarHitoCamara(storage, { cameraId: 'cam-crash', stage: 'CAPTURE_START', timestamp: new Date().toISOString() });
  await cargarTelemetry({ storage }).initTelemetry();

  assert.equal(eventosPrevious(storage).length, 1);
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_camara_v1')).status, 'reported');
});

test('si la persistencia del evento falla el marcador conserva in_progress y se reintenta', async () => {
  const storage = crearStorage();
  sembrarHitoCamara(storage, { cameraId: 'cam-fallo', stage: 'PREVIEW_START', timestamp: new Date().toISOString() });
  storage.registrarFallo('setItem', 'telemetry_outbox_v1', 2);

  await cargarTelemetry({ storage }).initTelemetry();
  assert.equal(eventosPrevious(storage).length, 0);
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_camara_v1')).status, 'in_progress');

  await cargarTelemetry({ storage }).initTelemetry();
  assert.equal(eventosPrevious(storage).length, 1);
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_camara_v1')).status, 'reported');
});

test('recordEvent no confirma persistencia cuando AsyncStorage falla', async () => {
  const storage = crearStorage();
  const telemetry = cargarTelemetry({ storage });

  assert.equal(await telemetry.recordEvent('sync_start', { app_state: 'active', sync_stage: 'uno' }), true);
  storage.registrarFallo('setItem', 'telemetry_outbox_v1', 1);
  assert.equal(await telemetry.recordEvent('sync_end', { app_state: 'active', sync_stage: 'dos' }), false);
  assert.equal(leerOutbox(storage).length, 1);
});

test('dos recordEvent concurrentes conservan ambos eventos en el outbox', async () => {
  const storage = crearStorage();
  const telemetry = cargarTelemetry({ storage });

  const [primero, segundo] = await Promise.all([
    telemetry.recordEvent('sync_start', { app_state: 'active', sync_stage: 'a' }),
    telemetry.recordEvent('sync_end', { app_state: 'active', sync_stage: 'b' }),
  ]);
  assert.equal(primero, true);
  assert.equal(segundo, true);
  assert.equal(leerOutbox(storage).length, 2);
});

test('un append durante la RPC del flush no se pierde con la eliminación', async () => {
  const storage = crearStorage();
  let invocada = false;
  let resolverRpc = null;
  const rpc = () => {
    invocada = true;
    return new Promise((resolver) => { resolverRpc = resolver; });
  };
  const telemetry = cargarTelemetry({ storage, rpc });

  await telemetry.recordEvent('sync_start', { app_state: 'active', sync_stage: 'uno' });
  const flush = telemetry.flushTelemetry();
  await esperarCondicion(() => invocada);
  assert.equal(await telemetry.recordEvent('sync_upload_start', { app_state: 'active', sync_stage: 'dos' }), true);
  resolverRpc({ data: null, error: null });
  const resultado = await flush;

  assert.equal(resultado.sent, 1);
  const outbox = leerOutbox(storage);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].sync_stage, 'dos');
});

test('un merge durante la RPC del flush no pierde occurrence_count', async () => {
  const storage = crearStorage();
  let invocada = false;
  let resolverRpc = null;
  const rpc = () => {
    invocada = true;
    return new Promise((resolver) => { resolverRpc = resolver; });
  };
  const telemetry = cargarTelemetry({ storage, rpc });
  const campos = { app_state: 'active', sync_stage: 'PREV_X', error_category: 'previous_incomplete' };

  assert.equal(await telemetry.recordEvent('photo_process_error', campos), true);
  const idOriginal = leerOutbox(storage)[0].event_id;

  const flush = telemetry.flushTelemetry();
  await esperarCondicion(() => invocada);
  assert.equal(await telemetry.recordEvent('photo_process_error', campos), true);
  resolverRpc({ data: null, error: null });
  await flush;

  const outbox = leerOutbox(storage);
  assert.equal(outbox.length, 1);
  assert.notEqual(outbox[0].event_id, idOriginal);
  assert.equal(outbox[0].occurrence_count, 1);
});

test('el merge por fingerprint sigue funcionando fuera de un envío en vuelo', async () => {
  const storage = crearStorage();
  const telemetry = cargarTelemetry({ storage });
  const campos = { app_state: 'active', sync_stage: 'PREV_Y', error_category: 'previous_incomplete' };

  assert.equal(await telemetry.recordEvent('photo_process_error', campos), true);
  assert.equal(await telemetry.recordEvent('photo_process_error', campos), true);

  const outbox = leerOutbox(storage);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].occurrence_count, 2);
});

test('event_id explícito deduplica y nunca se fusiona por fingerprint', async () => {
  const storage = crearStorage();
  const telemetry = cargarTelemetry({ storage });
  const campos = { app_state: 'active', sync_stage: 'PREV_Z', error_category: 'previous_incomplete' };
  const idA = telemetry.idEventoHito('camara', 'a');
  const idB = telemetry.idEventoHito('camara', 'b');

  assert.equal(await telemetry.recordEvent('photo_process_error', { ...campos, event_id: idA }), true);
  assert.equal(await telemetry.recordEvent('photo_process_error', { ...campos, event_id: idB }), true);
  assert.equal(leerOutbox(storage).length, 2);

  assert.equal(await telemetry.recordEvent('photo_process_error', { ...campos, event_id: idA }), true);
  assert.equal(leerOutbox(storage).length, 2);
});

test('ventana de 24 h: marcador viejo se limpia sin emitir y el reciente legacy se emite', async () => {
  const storage = crearStorage();
  sembrarHitoCamara(storage, {
    cameraId: 'cam-viejo',
    stage: 'PREVIEW_START',
    timestamp: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
  });
  await cargarTelemetry({ storage }).initTelemetry();
  assert.equal(eventosPrevious(storage).length, 0);
  assert.equal(storage.getRaw('ultimo_hito_camara_v1'), null);

  sembrarHitoCamara(storage, {
    cameraId: 'cam-legacy',
    stage: 'CAPTURE_REJECTED',
    timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    dimensionBucket: 'UNKNOWN',
  });
  const telemetry = cargarTelemetry({ storage });
  await telemetry.initTelemetry();

  const eventos = eventosPrevious(storage);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].sync_stage, 'PREV_CAPTURE_REJECTED');
  assert.equal(eventos[0].event_id, telemetry.idEventoHito('camara', 'cam-legacy'));
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_camara_v1')).status, 'reported');
});

test('marcador sin timestamp se emite (sesgo conservador) y reported no vuelve a emitir', async () => {
  const storage = crearStorage();
  sembrarHitoCamara(storage, { cameraId: 'cam-sin-ts', stage: 'CAMERA_OPEN' });
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_camara_v1')).timestamp, undefined);

  await cargarTelemetry({ storage }).initTelemetry();
  assert.equal(eventosPrevious(storage).length, 1);
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_camara_v1')).status, 'reported');

  await cargarTelemetry({ storage }).initTelemetry();
  assert.equal(eventosPrevious(storage).length, 1);
});

test('clean_background no suprime el hito y aporta previous_last_state', async () => {
  const storage = crearStorage();
  storage.setRaw('telemetry_run_current_v1', JSON.stringify({
    run_id: 'run-previo',
    started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    last_state: 'background',
    clean_background: true,
  }));
  sembrarHitoCamara(storage, { cameraId: 'cam-bg', stage: 'PREVIEW_START', timestamp: new Date().toISOString() });

  await cargarTelemetry({ storage }).initTelemetry();

  const eventos = eventosPrevious(storage);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].previous_last_state, 'background');
  assert.equal(eventos[0].native_exit_reason, undefined);
});

test('el hito de proceso de foto se emite como previous_photo con su bucket', async () => {
  const storage = crearStorage();
  sembrarHitoFoto(storage, {
    processId: 'foto-1',
    stage: 'PREP_START',
    timestamp: new Date().toISOString(),
    photoSizeBucket: '2-6MB',
  });

  const telemetry = cargarTelemetry({ storage });
  await telemetry.initTelemetry();

  const eventos = eventosPrevious(storage);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].phase, 'previous_photo');
  assert.equal(eventos[0].photo_size_bucket, '2-6MB');
  assert.equal(eventos[0].event_id, telemetry.idEventoHito('proceso', 'foto-1'));
  assert.equal(JSON.parse(storage.getRaw('ultimo_hito_procesamiento_foto_v1')).status, 'reported');
});
