const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const filename = path.resolve('lib/offlinePin.js');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const bytesToHex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => Uint8Array.from(String(hex).match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) || []);

const legacyHashBlock = (input) => {
  const value = String(input || '');
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
};

const legacyHashPin = (pin, salt) => {
  let digest = `${salt}:${pin}`;
  for (let i = 0; i < 800; i += 1) digest = legacyHashBlock(`${digest}:${i}`);
  return digest;
};

const loadOfflinePin = ({
  secureStore = {},
  legacyStore = {},
  derive = async () => Uint8Array.from([0xab, 0xcd]),
} = {}) => {
  let secureRaw = Object.keys(secureStore).length ? JSON.stringify(secureStore) : null;
  let legacyRaw = Object.keys(legacyStore).length ? JSON.stringify(legacyStore) : null;
  let secureReadFailure = false;
  let secureWriteFailure = false;
  let randomCounter = 1;
  const events = [];
  const secure = {
    reads: 0,
    writes: 0,
    async getItemAsync() {
      this.reads += 1;
      if (secureReadFailure) throw new Error('secure read failed');
      return secureRaw;
    },
    async setItemAsync(_key, value) {
      this.writes += 1;
      if (secureWriteFailure) throw new Error('secure write failed');
      secureRaw = value;
    },
  };
  const asyncStorage = {
    async getItem() {
      return legacyRaw;
    },
    async setItem(_key, value) {
      legacyRaw = value;
    },
  };
  const timeoutModule = {
    isTimeoutError: (error) => error?.name === 'TimeoutError',
    withTimeout: async (promise) => promise,
  };

  const { code } = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
  });
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === filename) {
      if (request === '@react-native-async-storage/async-storage') return asyncStorage;
      if (request === 'expo-secure-store') return secure;
      if (request === 'react-native') return { Platform: { OS: 'android' } };
      if (request === '@noble/hashes/scrypt.js') return { scryptAsync: derive };
      if (request === '@noble/hashes/utils.js') {
        return {
          bytesToHex,
          hexToBytes,
          randomBytes: (length) => {
            const value = randomCounter;
            randomCounter += 1;
            return Uint8Array.from({ length }, () => value);
          },
        };
      }
      if (request === './asyncTimeout') return timeoutModule;
      if (request === './telemetry') {
        return { recordEvent: async (name, fields) => events.push({ name, fields }) };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    loaded._compile(code, filename);
    return {
      api: loaded.exports,
      events,
      secure,
      setSecureReadFailure: (value) => { secureReadFailure = value; },
      setSecureWriteFailure: (value) => { secureWriteFailure = value; },
      readSecureStore: () => (secureRaw ? JSON.parse(secureRaw) : {}),
    };
  } finally {
    Module._load = originalLoad;
  }
};

const currentRecord = (overrides = {}) => ({
  version: 2,
  kdf: 'scrypt',
  revision: 'revision-1',
  salt: '0102',
  pinHash: 'abcd',
  failedAttempts: 0,
  lockUntil: 0,
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
  lastSuccessAt: null,
  ...overrides,
});

test('una derivacion simulada de 40 s avisa a los 10 s y termina con exito', async () => {
  const derivation = deferred();
  let fakeNow = 0;
  const timers = [];
  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  Date.now = () => fakeNow;
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, active: true };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.active = false;
  };

  try {
    const { api } = loadOfflinePin({
      secureStore: { userA: currentRecord() },
      derive: () => derivation.promise,
    });
    let slowNotices = 0;
    const verification = api.verifyOfflinePin({
      userId: 'userA',
      pin: '1234',
      onSlow: () => { slowNotices += 1; },
    });
    await flush();

    fakeNow = 10000;
    timers.filter((timer) => timer.active && timer.delay === 10000)
      .forEach((timer) => timer.callback());
    assert.equal(slowNotices, 1);

    fakeNow = 40000;
    derivation.resolve(Uint8Array.from([0xab, 0xcd]));
    assert.deepEqual(await verification, { ok: true });
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('doble pulsacion no inicia otra derivacion y un PIN incorrecto suma un intento', async () => {
  const derivation = deferred();
  let derivations = 0;
  const { api, readSecureStore } = loadOfflinePin({
    secureStore: { userA: currentRecord() },
    derive: () => {
      derivations += 1;
      return derivation.promise;
    },
  });

  const first = api.verifyOfflinePin({ userId: 'userA', pin: '9999' });
  await flush();
  assert.deepEqual(
    await api.verifyOfflinePin({ userId: 'userA', pin: '9999' }),
    { ok: false, reason: 'in_progress' },
  );
  derivation.resolve(Uint8Array.from([0x00, 0x01]));
  assert.deepEqual(await first, { ok: false, reason: 'invalid_pin', attemptsLeft: 4 });
  assert.equal(derivations, 1);
  assert.equal(readSecureStore().userA.failedAttempts, 1);
});

test('invalidar al usuario durante la derivacion impide un resultado exitoso tardio', async () => {
  const derivation = deferred();
  const { api } = loadOfflinePin({
    secureStore: { userA: currentRecord() },
    derive: () => derivation.promise,
  });

  const verification = api.verifyOfflinePin({ userId: 'userA', pin: '1234' });
  await flush();
  await api.clearOfflinePin('userA');
  derivation.resolve(Uint8Array.from([0xab, 0xcd]));
  assert.deepEqual(await verification, { ok: false, reason: 'unavailable' });
});

test('SecureStore inaccesible falla cerrado y no ejecuta scrypt', async () => {
  let derivations = 0;
  const loaded = loadOfflinePin({
    secureStore: { userA: currentRecord() },
    derive: async () => {
      derivations += 1;
      return Uint8Array.from([0xab, 0xcd]);
    },
  });
  loaded.setSecureReadFailure(true);
  assert.deepEqual(
    await loaded.api.verifyOfflinePin({ userId: 'userA', pin: '1234' }),
    { ok: false, reason: 'unavailable' },
  );
  assert.equal(derivations, 0);
});

test('un PIN legacy sigue validando y migra al formato seguro actual', async () => {
  const pin = '4321';
  const salt = 'legacy-salt';
  const { api, readSecureStore } = loadOfflinePin({
    legacyStore: {
      userA: {
        salt,
        pinHash: legacyHashPin(pin, salt),
        failedAttempts: 0,
        lockUntil: 0,
      },
    },
  });

  assert.deepEqual(await api.verifyOfflinePin({ userId: 'userA', pin }), { ok: true });
  assert.equal(readSecureStore().userA.kdf, 'scrypt');
});

test('la telemetria de verificacion no contiene PIN, hash, sal ni usuario', async () => {
  const { api, events } = loadOfflinePin({ secureStore: { userA: currentRecord() } });
  await api.verifyOfflinePin({ userId: 'userA', pin: '7391' });
  await flush();
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /7391|abcd|0102|userA/);
  assert.match(serialized, /pin_verify_phase|pin_verify_result/);
});

test('la verificacion offline no importa Supabase ni clientes de red', () => {
  const source = fs.readFileSync(filename, 'utf8');
  assert.doesNotMatch(source, /supabase|fetch\s*\(/i);
});

test('AuthScreen invalida resultados por desmontaje, usuario y conectividad', () => {
  const source = fs.readFileSync(path.resolve('components/AuthScreen.js'), 'utf8');
  assert.match(source, /mountedRef\.current/);
  assert.match(source, /cachedUserRef\.current\?\.id === userId/);
  assert.match(source, /isConnectedRef\.current === false/);
  assert.match(source, /offlinePinVerificationRef\.current\?\.id === verificationId/);
});
