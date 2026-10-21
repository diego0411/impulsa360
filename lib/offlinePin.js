import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { isTimeoutError, withTimeout } from './asyncTimeout';
import { recordEvent } from './telemetry';

const OFFLINE_PIN_KEY = 'offline_pin_v1';
const SECURE_PIN_KEY = 'impulsa360_offline_pin_v2';
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 6;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 5 * 60 * 1000;
const SCRYPT_OPTS = { N: 2 ** 14, r: 8, p: 1, dkLen: 32, asyncTick: 50 };
const SECURE_STORE_READ_TIMEOUT_MS = 10000;
const PIN_MUTATION_WAIT_TIMEOUT_MS = 10000;
const PIN_SAVE_SLOW_NOTICE_MS = 10000;
const PIN_VERIFY_SLOW_NOTICE_MS = 10000;

const secureStoreOptions = {
  keychainService: 'impulsa360.offline.pin',
};

const STORAGE_STATE = {
  OK: 'ok',
  ABSENT: 'absent',
  CORRUPT: 'corrupt',
  UNAVAILABLE: 'unavailable',
};

let mutationTail = Promise.resolve();
let activeMutation = null;
const userOperationEpochs = new Map();
const pendingPinSaves = new Map();
const pendingPinVerifications = new Map();
let pinDiagnosticTail = Promise.resolve();

const nowMs = () => Date.now();

const durationBucket = (durationMs) => {
  const value = Math.max(0, Number(durationMs) || 0);
  if (value < 1000) return 'lt1s';
  if (value < 3000) return '1-3s';
  if (value < 10000) return '3-10s';
  if (value < 30000) return '10-30s';
  if (value < 60000) return '30-60s';
  return 'gt60s';
};

const pinErrorCategory = (error) => {
  if (error?.code === 'PIN_MUTATION_INVALIDATED') return 'invalidated';
  if (error?.code === 'PIN_STORAGE_CORRUPT') return 'storage_corrupt';
  if (error?.code === 'PIN_STORAGE_UNAVAILABLE') return 'storage_unavailable';
  if (error?.code === 'PIN_DERIVATION_TIMEOUT') return 'derivation_timeout';
  if (error?.code === 'PIN_DERIVATION_FAILED') return 'derivation_failed';
  return 'pin_save_failed';
};

const recordPinDiagnostic = ({ event, phase, durationMs, errorCategory }) => {
  pinDiagnosticTail = pinDiagnosticTail
    .then(() => recordEvent('auth_change', {
      app_state: 'active',
      screen: 'offline_pin',
      phase: `pin_${event}`,
      sync_stage: `${phase}_${durationBucket(durationMs)}`,
      error_category: errorCategory,
    }))
    .catch(() => {});
};

const normalizePin = (pin) => String(pin || '').replace(/\D/g, '');

const isPinFormatValid = (pin) => {
  const normalized = normalizePin(pin);
  return normalized.length >= MIN_PIN_LENGTH && normalized.length <= MAX_PIN_LENGTH;
};

const isStoreObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

const storageError = (state) => {
  const error = new Error(
    state === STORAGE_STATE.CORRUPT
      ? 'El registro local del PIN no es válido. Conéctate a internet para recuperarlo sin sobrescribirlo.'
      : 'El almacenamiento seguro del PIN no está disponible. Intenta nuevamente.'
  );
  error.code = state === STORAGE_STATE.CORRUPT ? 'PIN_STORAGE_CORRUPT' : 'PIN_STORAGE_UNAVAILABLE';
  return error;
};

const pendingMutationError = () => {
  const error = new Error('El PIN todavía se está procesando de forma segura. Espera unos segundos antes de reintentar.');
  error.code = 'PIN_MUTATION_PENDING';
  return error;
};

const invalidatedMutationError = () => {
  const error = new Error('La sesión cambió antes de terminar la operación del PIN.');
  error.code = 'PIN_MUTATION_INVALIDATED';
  return error;
};

const getUserOperationEpoch = (userId) => userOperationEpochs.get(userId) || 0;

const assertOperationCurrent = (userId, epoch) => {
  if (getUserOperationEpoch(userId) !== epoch) throw invalidatedMutationError();
};

const parseStore = (raw) => {
  if (raw === null || raw === undefined) {
    return { state: STORAGE_STATE.ABSENT, store: {} };
  }
  try {
    const store = JSON.parse(raw);
    return isStoreObject(store)
      ? { state: STORAGE_STATE.OK, store }
      : { state: STORAGE_STATE.CORRUPT, store: {} };
  } catch {
    return { state: STORAGE_STATE.CORRUPT, store: {} };
  }
};

const readLegacyStore = async () => {
  try {
    return parseStore(await AsyncStorage.getItem(OFFLINE_PIN_KEY));
  } catch {
    return { state: STORAGE_STATE.UNAVAILABLE, store: {} };
  }
};

const writeLegacyStore = async (store) => {
  try {
    await AsyncStorage.setItem(OFFLINE_PIN_KEY, JSON.stringify(store));
  } catch {
    throw storageError(STORAGE_STATE.UNAVAILABLE);
  }
};

const readSecureStore = async () => {
  if (Platform.OS === 'web') return readLegacyStore();
  try {
    return parseStore(await withTimeout(
      SecureStore.getItemAsync(SECURE_PIN_KEY, secureStoreOptions),
      SECURE_STORE_READ_TIMEOUT_MS,
      'El almacenamiento seguro del PIN no respondió al leer.'
    ));
  } catch {
    return { state: STORAGE_STATE.UNAVAILABLE, store: {} };
  }
};

const writeSecureStore = async (store) => {
  const safe = isStoreObject(store) ? store : {};
  try {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(OFFLINE_PIN_KEY, JSON.stringify(safe));
      return;
    }
    // SecureStore no expone cancelación. Una escritura iniciada debe terminar
    // antes de permitir otra mutación sobre el registro compartido.
    await SecureStore.setItemAsync(SECURE_PIN_KEY, JSON.stringify(safe), secureStoreOptions);
  } catch {
    throw storageError(STORAGE_STATE.UNAVAILABLE);
  }
};

const randomSalt = () => bytesToHex(randomBytes(16));

const legacyHashBlock = (input) => {
  const str = String(input || '');
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const left = (h2 >>> 0).toString(16).padStart(8, '0');
  const right = (h1 >>> 0).toString(16).padStart(8, '0');
  return `${left}${right}`;
};

const legacyHashPin = (pin, salt) => {
  let digest = `${salt}:${normalizePin(pin)}`;
  for (let i = 0; i < 800; i += 1) {
    digest = legacyHashBlock(`${digest}:${i}`);
  }
  return digest;
};

const hashPin = async (pin, salt, { waitForCompletion = false } = {}) => {
  try {
    const derivation = scryptAsync(normalizePin(pin), hexToBytes(salt), SCRYPT_OPTS);
    const result = waitForCompletion
      ? await derivation
      : await withTimeout(derivation, 10000, 'No se pudo procesar el PIN.');
    return bytesToHex(result);
  } catch (error) {
    if (isTimeoutError(error)) {
      const timeoutError = new Error('La derivación del PIN excedió el tiempo permitido. Intenta de nuevo.');
      timeoutError.code = 'PIN_DERIVATION_TIMEOUT';
      throw timeoutError;
    }
    const derivationError = new Error('No se pudo procesar el PIN. Intenta de nuevo.');
    derivationError.code = 'PIN_DERIVATION_FAILED';
    throw derivationError;
  }
};

const equalHex = (a, b) => {
  const left = String(a || '');
  const right = String(b || '');
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
};

const isValidPinRecord = (record, { legacy = false } = {}) => (
  isStoreObject(record)
  && typeof record.salt === 'string'
  && record.salt.length > 0
  && typeof record.pinHash === 'string'
  && record.pinHash.length > 0
  && (legacy || (/^[0-9a-f]+$/i.test(record.salt) && record.salt.length % 2 === 0))
);

const sameRecord = (left, right) => (
  left?.revision === right?.revision
  && left?.salt === right?.salt
  && left?.pinHash === right?.pinHash
  && left?.updatedAt === right?.updatedAt
);

const readRecord = async (userId) => {
  if (!userId) return { state: STORAGE_STATE.ABSENT, record: null };

  const secure = await readSecureStore();
  if (secure.state === STORAGE_STATE.CORRUPT || secure.state === STORAGE_STATE.UNAVAILABLE) {
    return { state: secure.state, record: null };
  }

  if (secure.store[userId] !== undefined) {
    return isValidPinRecord(secure.store[userId])
      ? { state: STORAGE_STATE.OK, record: secure.store[userId], source: 'secure' }
      : { state: STORAGE_STATE.CORRUPT, record: null };
  }

  if (Platform.OS === 'web') return { state: STORAGE_STATE.ABSENT, record: null };

  const legacy = await readLegacyStore();
  if (legacy.state === STORAGE_STATE.CORRUPT || legacy.state === STORAGE_STATE.UNAVAILABLE) {
    return { state: legacy.state, record: null };
  }
  if (legacy.store[userId] === undefined) return { state: STORAGE_STATE.ABSENT, record: null };
  return isValidPinRecord(legacy.store[userId], { legacy: true })
    ? { state: STORAGE_STATE.OK, record: { ...legacy.store[userId], legacy: true }, source: 'legacy' }
    : { state: STORAGE_STATE.CORRUPT, record: null };
};

const runMutation = (mutation, { confirm, allowQueue = false, onPhase } = {}) => {
  if (activeMutation && !allowQueue) throw pendingMutationError();

  const execute = async () => {
    onPhase?.('read');
    const secure = await readSecureStore();
    if (secure.state === STORAGE_STATE.CORRUPT || secure.state === STORAGE_STATE.UNAVAILABLE) {
      throw storageError(secure.state);
    }

    const store = { ...secure.store };
    const result = await mutation(store, onPhase);
    onPhase?.('write');
    await writeSecureStore(store);

    onPhase?.('reread');
    const confirmed = await readSecureStore();
    if (confirmed.state !== STORAGE_STATE.OK) {
      throw storageError(confirmed.state === STORAGE_STATE.CORRUPT ? STORAGE_STATE.CORRUPT : STORAGE_STATE.UNAVAILABLE);
    }
    if (confirm) {
      onPhase?.('confirm');
      await confirm({ result, store: confirmed.store, onPhase });
    }
    return { result, store: confirmed.store };
  };

  const operation = mutationTail.then(execute, execute);
  mutationTail = operation.catch(() => {});
  activeMutation = operation;
  operation.finally(() => {
    if (activeMutation === operation) activeMutation = null;
  }).catch(() => {});
  return operation;
};

const waitForMutation = async (operation) => {
  try {
    return await withTimeout(
      operation,
      PIN_MUTATION_WAIT_TIMEOUT_MS,
      'El almacenamiento seguro sigue procesando el PIN.'
    );
  } catch (error) {
    if (isTimeoutError(error)) throw pendingMutationError();
    throw error;
  }
};

const updateCurrentRecord = async (
  userId,
  expectedRecord,
  buildNextRecord,
  { waitForCompletion = false } = {}
) => {
  const operation = runMutation((store) => {
    const current = store[userId];
    if (!isValidPinRecord(current) || !sameRecord(current, expectedRecord)) {
      return { changed: false };
    }
    store[userId] = buildNextRecord(current);
    return { changed: true };
  });
  const { result } = waitForCompletion
    ? await operation
    : await waitForMutation(operation);
  return result.changed;
};

export const pinPolicy = {
  minLength: MIN_PIN_LENGTH,
  maxLength: MAX_PIN_LENGTH,
  maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  lockWindowMs: LOCK_WINDOW_MS,
};

export const getOfflinePinStatus = async (userId) => {
  const detail = await readRecord(userId);
  if (detail.state !== STORAGE_STATE.OK) {
    return {
      configured: false,
      storageState: detail.state,
      locked: false,
      remainingSeconds: 0,
      failedAttempts: 0,
      attemptsLeft: MAX_FAILED_ATTEMPTS,
    };
  }

  const lockUntil = Number(detail.record.lockUntil || 0);
  const remainingMs = Math.max(0, lockUntil - nowMs());
  const locked = remainingMs > 0;
  const failedAttempts = Number(detail.record.failedAttempts || 0);
  return {
    configured: true,
    storageState: STORAGE_STATE.OK,
    locked,
    remainingSeconds: locked ? Math.ceil(remainingMs / 1000) : 0,
    failedAttempts,
    attemptsLeft: locked ? 0 : Math.max(0, MAX_FAILED_ATTEMPTS - failedAttempts),
  };
};

export const hasOfflinePin = async (userId) => {
  const status = await getOfflinePinStatus(userId);
  if (status.storageState === STORAGE_STATE.CORRUPT || status.storageState === STORAGE_STATE.UNAVAILABLE) {
    throw storageError(status.storageState);
  }
  return status.configured;
};

export const getPendingOfflinePinSave = (userId) => {
  const pending = userId ? pendingPinSaves.get(userId) : null;
  if (!pending) return null;
  return {
    promise: pending.promise,
    slow: pending.slow,
    phase: pending.phase,
    startedAt: pending.startedAt,
  };
};

export const saveOfflinePin = async ({ userId, pin }) => {
  if (!userId) {
    throw new Error('Usuario inválido para configurar PIN.');
  }
  if (!isPinFormatValid(pin)) {
    throw new Error(`El PIN debe tener entre ${MIN_PIN_LENGTH} y ${MAX_PIN_LENGTH} dígitos.`);
  }

  if (pendingPinSaves.has(userId)) throw pendingMutationError();

  const startedAt = nowMs();
  const progress = {
    phase: 'queued',
    phaseStartedAt: startedAt,
    slow: false,
    startedAt,
    promise: null,
  };
  const setPhase = (phase) => {
    const timestamp = nowMs();
    recordPinDiagnostic({
      event: 'phase',
      phase: progress.phase,
      durationMs: timestamp - progress.phaseStartedAt,
    });
    progress.phase = phase;
    progress.phaseStartedAt = timestamp;
  };
  const operationEpoch = getUserOperationEpoch(userId);
  let operation;
  try {
    operation = runMutation(async (currentStore, onPhase) => {
      assertOperationCurrent(userId, operationEpoch);
      onPhase?.('derive');
      const salt = randomSalt();
      const pinHash = await hashPin(pin, salt, { waitForCompletion: true });
      assertOperationCurrent(userId, operationEpoch);
      const timestamp = new Date().toISOString();
      const record = {
        version: 2,
        kdf: 'scrypt',
        revision: randomSalt(),
        salt,
        pinHash,
        failedAttempts: 0,
        lockUntil: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSuccessAt: null,
      };
      currentStore[userId] = record;
      return record;
    }, {
      allowQueue: true,
      onPhase: setPhase,
      confirm: async ({ result, store }) => {
        assertOperationCurrent(userId, operationEpoch);
        const confirmed = store[userId];
        if (
          !isValidPinRecord(confirmed)
          || confirmed.revision !== result.revision
          || confirmed.salt !== result.salt
          || !equalHex(confirmed.pinHash, result.pinHash)
        ) {
          throw new Error('El PIN no pudo confirmarse en el almacenamiento seguro. Intenta nuevamente.');
        }
      },
    });
  } catch (error) {
    recordPinDiagnostic({
      event: 'result',
      phase: progress.phase,
      durationMs: nowMs() - startedAt,
      errorCategory: pinErrorCategory(error),
    });
    throw error;
  }

  const slowTimer = globalThis.setTimeout(() => {
    progress.slow = true;
    recordPinDiagnostic({
      event: 'slow',
      phase: progress.phase,
      durationMs: nowMs() - startedAt,
      errorCategory: 'still_processing',
    });
  }, PIN_SAVE_SLOW_NOTICE_MS);

  const definitive = operation.then(() => {
    setPhase('complete');
    recordPinDiagnostic({
      event: 'result',
      phase: 'complete',
      durationMs: nowMs() - startedAt,
      errorCategory: 'success',
    });
    return true;
  }).catch((error) => {
    recordPinDiagnostic({
      event: 'result',
      phase: progress.phase,
      durationMs: nowMs() - startedAt,
      errorCategory: pinErrorCategory(error),
    });
    throw error;
  }).finally(() => {
    globalThis.clearTimeout(slowTimer);
    if (pendingPinSaves.get(userId) === progress) pendingPinSaves.delete(userId);
  });

  progress.promise = definitive;
  pendingPinSaves.set(userId, progress);
  return definitive;
};

export const clearOfflinePin = async (userId, { preserveUpdatedAfter = 0 } = {}) => {
  if (!userId) return false;
  userOperationEpochs.set(userId, getUserOperationEpoch(userId) + 1);
  const { result } = await runMutation((store) => {
    const record = store[userId];
    const updatedAt = Date.parse(record?.updatedAt || '');
    if (preserveUpdatedAfter > 0 && Number.isFinite(updatedAt) && updatedAt > preserveUpdatedAfter) {
      return { cleared: false };
    }
    delete store[userId];
    return { cleared: true };
  }, { allowQueue: true });

  if (Platform.OS !== 'web') {
    const legacy = await readLegacyStore();
    if (legacy.state === STORAGE_STATE.CORRUPT || legacy.state === STORAGE_STATE.UNAVAILABLE) {
      throw storageError(legacy.state);
    }
    if (legacy.store[userId] !== undefined) {
      delete legacy.store[userId];
      await writeLegacyStore(legacy.store);
    }
  }
  return result.cleared;
};

const executeOfflinePinVerification = async ({ userId, pin, operationEpoch, setPhase }) => {
  assertOperationCurrent(userId, operationEpoch);
  setPhase('read');
  const detail = await readRecord(userId);
  assertOperationCurrent(userId, operationEpoch);

  if (detail.state === STORAGE_STATE.ABSENT) {
    return { ok: false, reason: 'not_configured' };
  }
  if (detail.state === STORAGE_STATE.CORRUPT) {
    return { ok: false, reason: 'corrupt' };
  }
  if (detail.state !== STORAGE_STATE.OK) {
    return { ok: false, reason: 'unavailable' };
  }

  const { record } = detail;
  const currentMs = nowMs();
  const lockUntil = Number(record.lockUntil || 0);
  if (lockUntil > currentMs) {
    const remainingSeconds = Math.ceil((lockUntil - currentMs) / 1000);
    return { ok: false, reason: 'locked', remainingSeconds };
  }

  let candidate;
  try {
    setPhase(record.legacy ? 'legacy_derive' : 'derive');
    candidate = record.legacy
      ? legacyHashPin(pin, record.salt)
      : await hashPin(pin, record.salt, { waitForCompletion: true });
    assertOperationCurrent(userId, operationEpoch);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  setPhase('compare');
  if (equalHex(candidate, record.pinHash)) {
    try {
      setPhase(record.legacy ? 'legacy_migrate' : 'persist_success');
      if (record.legacy) {
        await saveOfflinePin({ userId, pin });
      } else {
        const changed = await updateCurrentRecord(userId, record, (current) => {
          assertOperationCurrent(userId, operationEpoch);
          return {
            ...current,
            failedAttempts: 0,
            lockUntil: 0,
            updatedAt: new Date().toISOString(),
            lastSuccessAt: new Date().toISOString(),
          };
        }, { waitForCompletion: true });
        if (!changed) return { ok: false, reason: 'unavailable' };
      }
      assertOperationCurrent(userId, operationEpoch);
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true };
  }

  const nextFailedAttempts = Number(record.failedAttempts || 0) + 1;
  if (nextFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    try {
      setPhase('persist_lock');
      const changed = await updateCurrentRecord(userId, record, (current) => {
        assertOperationCurrent(userId, operationEpoch);
        return {
          ...current,
          failedAttempts: 0,
          lockUntil: currentMs + LOCK_WINDOW_MS,
          updatedAt: new Date().toISOString(),
        };
      }, { waitForCompletion: true });
      if (!changed) return { ok: false, reason: 'unavailable' };
      assertOperationCurrent(userId, operationEpoch);
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    return {
      ok: false,
      reason: 'locked',
      remainingSeconds: Math.ceil(LOCK_WINDOW_MS / 1000),
      attemptsLeft: 0,
    };
  }

  try {
    setPhase('persist_attempt');
    const changed = await updateCurrentRecord(userId, record, (current) => {
      assertOperationCurrent(userId, operationEpoch);
      return {
        ...current,
        failedAttempts: nextFailedAttempts,
        lockUntil: 0,
        updatedAt: new Date().toISOString(),
      };
    }, { waitForCompletion: true });
    if (!changed) return { ok: false, reason: 'unavailable' };
    assertOperationCurrent(userId, operationEpoch);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  return {
    ok: false,
    reason: 'invalid_pin',
    attemptsLeft: MAX_FAILED_ATTEMPTS - nextFailedAttempts,
  };
};

export const verifyOfflinePin = async ({ userId, pin, onSlow }) => {
  if (!userId) {
    return { ok: false, reason: 'invalid_user' };
  }
  if (!isPinFormatValid(pin)) {
    return { ok: false, reason: 'invalid_format' };
  }

  if (pendingPinVerifications.has(userId)) {
    return { ok: false, reason: 'in_progress' };
  }

  const startedAt = nowMs();
  const progress = {
    phase: 'start',
    phaseStartedAt: startedAt,
    promise: null,
  };
  const setPhase = (phase) => {
    const timestamp = nowMs();
    recordPinDiagnostic({
      event: 'verify_phase',
      phase: progress.phase,
      durationMs: timestamp - progress.phaseStartedAt,
    });
    progress.phase = phase;
    progress.phaseStartedAt = timestamp;
  };
  const operationEpoch = getUserOperationEpoch(userId);
  const operation = executeOfflinePinVerification({
    userId,
    pin,
    operationEpoch,
    setPhase,
  });

  const slowTimer = globalThis.setTimeout(() => {
    if (pendingPinVerifications.get(userId) !== progress) return;
    recordPinDiagnostic({
      event: 'verify_slow',
      phase: progress.phase,
      durationMs: nowMs() - startedAt,
      errorCategory: 'still_processing',
    });
    try {
      onSlow?.();
    } catch {
      // El aviso es informativo y nunca altera la verificación.
    }
  }, PIN_VERIFY_SLOW_NOTICE_MS);

  const definitive = operation.then((result) => {
    setPhase('complete');
    recordPinDiagnostic({
      event: 'verify_result',
      phase: result.ok ? 'success' : result.reason,
      durationMs: nowMs() - startedAt,
      errorCategory: result.ok ? 'success' : result.reason,
    });
    return result;
  }).catch((error) => {
    recordPinDiagnostic({
      event: 'verify_result',
      phase: progress.phase,
      durationMs: nowMs() - startedAt,
      errorCategory: pinErrorCategory(error),
    });
    return { ok: false, reason: 'unavailable' };
  }).finally(() => {
    globalThis.clearTimeout(slowTimer);
    if (pendingPinVerifications.get(userId) === progress) {
      pendingPinVerifications.delete(userId);
    }
  });

  progress.promise = definitive;
  pendingPinVerifications.set(userId, progress);
  return definitive;
};
