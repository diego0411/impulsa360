import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFLINE_PIN_KEY = 'offline_pin_v1';
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 6;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 5 * 60 * 1000;

const nowMs = () => Date.now();

const normalizePin = (pin) => String(pin || '').replace(/\D/g, '');

const isPinFormatValid = (pin) => {
  const normalized = normalizePin(pin);
  return normalized.length >= MIN_PIN_LENGTH && normalized.length <= MAX_PIN_LENGTH;
};

const readStore = async () => {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_PIN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = async (store) => {
  const safe = store && typeof store === 'object' ? store : {};
  await AsyncStorage.setItem(OFFLINE_PIN_KEY, JSON.stringify(safe));
};

const randomSalt = () =>
  `${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;

// Hash liviano para no persistir el PIN en claro.
const hashBlock = (input) => {
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

const hashPin = (pin, salt) => {
  let digest = `${salt}:${normalizePin(pin)}`;
  for (let i = 0; i < 800; i += 1) {
    digest = hashBlock(`${digest}:${i}`);
  }
  return digest;
};

const getRecord = async (userId) => {
  if (!userId) return null;
  const store = await readStore();
  return store[userId] || null;
};

const setRecord = async (userId, record) => {
  const store = await readStore();
  store[userId] = record;
  await writeStore(store);
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

  const normalized = normalizePin(pin);
  const salt = randomSalt();
  const pinHash = hashPin(normalized, salt);
  const timestamp = new Date().toISOString();

  await setRecord(userId, {
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
  const store = await readStore();
  delete store[userId];
  await writeStore(store);
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

  const normalized = normalizePin(pin);
  const candidate = hashPin(normalized, record.salt);

  if (candidate === record.pinHash) {
    await setRecord(userId, {
      ...record,
      failedAttempts: 0,
      lockUntil: 0,
      updatedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  const nextFailedAttempts = Number(record.failedAttempts || 0) + 1;
  if (nextFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    const nextLockUntil = currentMs + LOCK_WINDOW_MS;
    await setRecord(userId, {
      ...record,
      failedAttempts: 0,
      lockUntil: nextLockUntil,
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: false,
      reason: 'locked',
      remainingSeconds: Math.ceil(LOCK_WINDOW_MS / 1000),
      attemptsLeft: 0,
    };
  }

  await setRecord(userId, {
    ...record,
    failedAttempts: nextFailedAttempts,
    lockUntil: 0,
    updatedAt: new Date().toISOString(),
  });

  return {
    ok: false,
    reason: 'invalid_pin',
    attemptsLeft: MAX_FAILED_ATTEMPTS - nextFailedAttempts,
  };
};

