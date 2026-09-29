import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { isTimeoutError, withTimeout } from './asyncTimeout';

const OFFLINE_PIN_KEY = 'offline_pin_v1';
const SECURE_PIN_KEY = 'impulsa360_offline_pin_v2';
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 6;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 5 * 60 * 1000;
const SCRYPT_OPTS = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 };
const SECURE_STORE_TIMEOUT_MS = 10000;

const secureStoreOptions = {
  keychainService: 'impulsa360.offline.pin',
};

const nowMs = () => Date.now();

const normalizePin = (pin) => String(pin || '').replace(/\D/g, '');

const isPinFormatValid = (pin) => {
  const normalized = normalizePin(pin);
  return normalized.length >= MIN_PIN_LENGTH && normalized.length <= MAX_PIN_LENGTH;
};

const readLegacyStore = async () => {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_PIN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const readSecureStore = async () => {
  if (Platform.OS === 'web') return readLegacyStore();
  try {
    const raw = await withTimeout(
      SecureStore.getItemAsync(SECURE_PIN_KEY, secureStoreOptions),
      SECURE_STORE_TIMEOUT_MS,
      'El almacenamiento seguro no respondió al leer el PIN.'
    );
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (isTimeoutError(error)) throw error;
    throw new Error('No se pudo leer el PIN desde el almacenamiento seguro.');
  }
};

const writeSecureStore = async (store) => {
  const safe = store && typeof store === 'object' ? store : {};
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(OFFLINE_PIN_KEY, JSON.stringify(safe));
    return;
  }
  try {
    await withTimeout(
      SecureStore.setItemAsync(SECURE_PIN_KEY, JSON.stringify(safe), secureStoreOptions),
      SECURE_STORE_TIMEOUT_MS,
      'El almacenamiento seguro no respondió al guardar el PIN.'
    );
  } catch (error) {
    if (isTimeoutError(error)) throw error;
    throw new Error('No se pudo guardar el PIN de forma segura. Intenta de nuevo.');
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

const hashPin = async (pin, salt) => {
  try {
    return bytesToHex(await withTimeout(
      scryptAsync(normalizePin(pin), hexToBytes(salt), SCRYPT_OPTS),
      10000,
      'No se pudo procesar el PIN.'
    ));
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error('La derivación del PIN excedió el tiempo permitido. Intenta de nuevo.');
    }
    throw new Error('No se pudo procesar el PIN. Intenta de nuevo.');
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

const getRecord = async (userId) => {
  if (!userId) return null;
  const secure = await readSecureStore();
  if (secure[userId]) return secure[userId];
  const legacy = await readLegacyStore();
  return legacy[userId] ? { ...legacy[userId], legacy: true } : null;
};

const setRecord = async (userId, record) => {
  const store = await readSecureStore();
  store[userId] = record;
  await writeSecureStore(store);
};

export const pinPolicy = {
  minLength: MIN_PIN_LENGTH,
  maxLength: MAX_PIN_LENGTH,
  maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  lockWindowMs: LOCK_WINDOW_MS,
};

export const getOfflinePinStatus = async (userId) => {
  const record = await getRecord(userId);
  if (!record) {
    return {
      configured: false,
      locked: false,
      remainingSeconds: 0,
      failedAttempts: 0,
      attemptsLeft: MAX_FAILED_ATTEMPTS,
    };
  }

  const lockUntil = Number(record.lockUntil || 0);
  const remainingMs = Math.max(0, lockUntil - nowMs());
  const locked = remainingMs > 0;
  const failedAttempts = Number(record.failedAttempts || 0);
  return {
    configured: true,
    locked,
    remainingSeconds: locked ? Math.ceil(remainingMs / 1000) : 0,
    failedAttempts,
    attemptsLeft: locked ? 0 : Math.max(0, MAX_FAILED_ATTEMPTS - failedAttempts),
  };
};

export const hasOfflinePin = async (userId) => {
  const status = await getOfflinePinStatus(userId);
  return status.configured;
};

export const saveOfflinePin = async ({ userId, pin }) => {
  if (!userId) {
    throw new Error('Usuario inválido para configurar PIN.');
  }
  if (!isPinFormatValid(pin)) {
    throw new Error(`El PIN debe tener entre ${MIN_PIN_LENGTH} y ${MAX_PIN_LENGTH} dígitos.`);
  }

  const salt = randomSalt();
  const pinHash = await hashPin(pin, salt);
  const timestamp = new Date().toISOString();

  await setRecord(userId, {
    version: 2,
    kdf: 'scrypt',
    salt,
    pinHash,
    failedAttempts: 0,
    lockUntil: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSuccessAt: null,
  });

  return true;
};

export const clearOfflinePin = async (userId) => {
  if (!userId) return;
  try {
    const store = await readSecureStore();
    delete store[userId];
    await writeSecureStore(store);
  } catch {
    // Limpieza best-effort: nunca rechaza para no interrumpir el flujo.
  }
};

export const verifyOfflinePin = async ({ userId, pin }) => {
  if (!userId) {
    return { ok: false, reason: 'invalid_user' };
  }
  if (!isPinFormatValid(pin)) {
    return { ok: false, reason: 'invalid_format' };
  }

  const record = await getRecord(userId);
  if (!record?.salt || !record?.pinHash) {
    return { ok: false, reason: 'not_configured' };
  }

  const currentMs = nowMs();
  const lockUntil = Number(record.lockUntil || 0);
  if (lockUntil > currentMs) {
    const remainingSeconds = Math.ceil((lockUntil - currentMs) / 1000);
    return { ok: false, reason: 'locked', remainingSeconds };
  }

  let candidate;
  try {
    candidate = record.legacy
      ? legacyHashPin(pin, record.salt)
      : await hashPin(pin, record.salt);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (equalHex(candidate, record.pinHash)) {
    try {
      if (record.legacy) {
        await saveOfflinePin({ userId, pin });
      } else {
        await setRecord(userId, {
          ...record,
          failedAttempts: 0,
          lockUntil: 0,
          updatedAt: new Date().toISOString(),
          lastSuccessAt: new Date().toISOString(),
        });
      }
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true };
  }

  const nextFailedAttempts = Number(record.failedAttempts || 0) + 1;
  if (nextFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    const nextLockUntil = currentMs + LOCK_WINDOW_MS;
    try {
      await setRecord(userId, {
        ...record,
        failedAttempts: 0,
        lockUntil: nextLockUntil,
        updatedAt: new Date().toISOString(),
      });
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
    await setRecord(userId, {
      ...record,
      failedAttempts: nextFailedAttempts,
      lockUntil: 0,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  return {
    ok: false,
    reason: 'invalid_pin',
    attemptsLeft: MAX_FAILED_ATTEMPTS - nextFailedAttempts,
  };
};
