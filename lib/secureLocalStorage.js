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

// Single-flight para creación/lectura de clave: evita carreras que generen
// claves distintas y valores mutuamente ilegibles en primera instalación.
let keyCache = null;
let keyPromise = null;

const getOrCreateKey = async () => {
  if (Platform.OS === 'web') return null;
  if (keyCache) return keyCache;
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    try {
      const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY, secureStoreOptions);
      if (existing) {
        keyCache = fromBase64(existing);
        return keyCache;
      }
      const key = randomBytes(32);
      await SecureStore.setItemAsync(ENCRYPTION_KEY, toBase64(key), secureStoreOptions);
      keyCache = key;
      return keyCache;
    } catch {
      // Keystore bloqueado/inaccesible: no se inventa ni rota clave.
      return null;
    } finally {
      keyPromise = null;
    }
  })();
  return keyPromise;
};

export const encryptLocalValue = async (value, aad = '') => {
  if (value === null || value === undefined || Platform.OS === 'web') return value;
  const key = await getOrCreateKey();
  if (!key) throw new Error('SECURE_KEY_UNAVAILABLE');
  try {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = xchacha20poly1305(key, nonce, utf8ToBytes(String(aad))).encrypt(utf8ToBytes(String(value)));
    return `${PREFIX}${toBase64(concatBytes(nonce, cipher))}`;
  } catch {
    throw new Error('SECURE_ENCRYPT_FAILED');
  }
};

export const decryptLocalValue = async (value, aad = '') => {
  if (!isEncrypted(value) || Platform.OS === 'web') return value;
  const key = await getOrCreateKey();
  if (!key) throw new Error('SECURE_KEY_UNAVAILABLE');
  try {
    const sealed = fromBase64(value.slice(PREFIX.length));
    const nonce = sealed.slice(0, NONCE_LENGTH);
    const cipher = sealed.slice(NONCE_LENGTH);
    return bytesToUtf8(xchacha20poly1305(key, nonce, utf8ToBytes(String(aad))).decrypt(cipher));
  } catch {
    throw new Error('SECURE_DECRYPT_FAILED');
  }
};

// Lectura discriminada: permite distinguir dato ausente de ciphertext
// temporalmente ilegible o corrupto sin destruir evidencia local.
export const leerRegistroSeguro = async (key) => {
  let raw;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return { status: 'temporarily_unreadable', value: null };
  }
  if (raw === null || raw === undefined) return { status: 'absent', value: null };
  if (!isEncrypted(raw) || Platform.OS === 'web') return { status: 'ok', value: raw, legacy: true };
  try {
    const value = await decryptLocalValue(raw, key);
    return { status: 'ok', value };
  } catch (error) {
    if (error?.message === 'SECURE_KEY_UNAVAILABLE') {
      return { status: 'temporarily_unreadable', value: null };
    }
    return { status: 'corrupt', value: null };
  }
};

export const secureLocalStorage = {
  async getItem(key) {
    const detalle = await leerRegistroSeguro(key);
    if (detalle.status === 'ok') {
      // Migración best-effort de legacy a cifrado; un fallo nunca rompe lectura.
      if (detalle.legacy && Platform.OS !== 'web') {
        this.setItem(key, detalle.value).catch(() => {});
      }
      return detalle.value;
    }
    return null;
  },

  // Fail-closed: cualquier fallo de cifrado o escritura se propaga como
  // excepción. NUNCA se guarda plaintext en nativo ni se retorna false
  // como éxito. El llamador debe tratar el rechazo como fallo durable.
  async setItem(key, value) {
    const payload = await encryptLocalValue(value, key);
    if (Platform.OS !== 'web' && !isEncrypted(payload)) {
      throw new Error('No se pudo cifrar el valor local.');
    }
    const result = await AsyncStorage.setItem(key, payload);
    if (result === false) {
      throw new Error('No se pudo persistir el valor local de forma segura.');
    }
    return true;
  },

  async removeItem(key) {
    await AsyncStorage.removeItem(key);
    return true;
  },

  async getRawItem(key) {
    return AsyncStorage.getItem(key);
  },
};
