import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes, utf8ToBytes, bytesToUtf8, concatBytes } from '@noble/ciphers/utils.js';
import { decode, encode } from 'base64-arraybuffer';

const ENCRYPTION_KEY = 'impulsa360_secure_storage_key_v1';
const PREFIX = 'slc1:';
const NONCE_LENGTH = 24;

const toBase64 = (bytes) => encode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const fromBase64 = (value) => new Uint8Array(decode(value));
const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX);

const secureStoreOptions = {
  keychainService: 'impulsa360.secure.local.storage',
};

const getOrCreateKey = async () => {
  if (Platform.OS === 'web') return null;
  try {
    const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY, secureStoreOptions);
    if (existing) return fromBase64(existing);

    const key = randomBytes(32);
    await SecureStore.setItemAsync(ENCRYPTION_KEY, toBase64(key), secureStoreOptions);
    return key;
  } catch {
    // Keystore bloqueado/inaccesible (p. ej. tras reinicio): no se inventa ni
    // rota la clave; se retorna null para degradar de forma controlada.
    return null;
  }
};

export const encryptLocalValue = async (value, aad = '') => {
  if (value === null || value === undefined || Platform.OS === 'web') return value;
  try {
    const key = await getOrCreateKey();
    if (!key) return String(value);
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = xchacha20poly1305(key, nonce, utf8ToBytes(String(aad))).encrypt(utf8ToBytes(String(value)));
    return `${PREFIX}${toBase64(concatBytes(nonce, cipher))}`;
  } catch {
    return String(value);
  }
};

export const decryptLocalValue = async (value, aad = '') => {
  if (!isEncrypted(value) || Platform.OS === 'web') return value;
  try {
    const key = await getOrCreateKey();
    if (!key) return null;
    const sealed = fromBase64(value.slice(PREFIX.length));
    const nonce = sealed.slice(0, NONCE_LENGTH);
    const cipher = sealed.slice(NONCE_LENGTH);
    return bytesToUtf8(xchacha20poly1305(key, nonce, utf8ToBytes(String(aad))).decrypt(cipher));
  } catch {
    // Dato corrupto o clave inaccesible: null en vez de rechazo no capturado.
    return null;
  }
};

export const secureLocalStorage = {
  async getItem(key) {
    try {
      const value = await AsyncStorage.getItem(key);
      if (!isEncrypted(value)) {
        if (value !== null && value !== undefined && Platform.OS !== 'web') {
          this.setItem(key, value).catch(() => {});
        }
        return value;
      }
      return await decryptLocalValue(value, key);
    } catch {
      return null;
    }
  },

  async setItem(key, value) {
    try {
      const encrypted = await encryptLocalValue(value, key);
      await AsyncStorage.setItem(key, encrypted);
    } catch {
      try {
        await AsyncStorage.setItem(key, String(value));
      } catch {
        // Almacenamiento inaccesible: se resuelve sin rechazar para no cerrar la app.
      }
    }
  },

  async removeItem(key) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Sin rechazo: limpieza best-effort.
    }
  },

  async getRawItem(key) {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
};

export const isSecureLocalValue = isEncrypted;
