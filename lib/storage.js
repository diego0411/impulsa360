// lib/storage.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const memoryStore = new Map();
const log = (...args) => console.log('📦 storage:', ...args);

// Adaptador de almacenamiento según plataforma (web usa localStorage, fallback memoria)
const storageAdapter = (() => {
  if (Platform.OS === 'web' && globalThis.localStorage) {
    log('Usando localStorage como backend');
    return {
      async getItem(k) {
        return globalThis.localStorage.getItem(k);
      },
      async setItem(k, v) {
        return globalThis.localStorage.setItem(k, v);
      },
    };
  }
  log('Usando AsyncStorage como backend');
  return {
    async getItem(k) {
      return AsyncStorage.getItem(k);
    },
    async setItem(k, v) {
      return AsyncStorage.setItem(k, v);
    },
  };
})();

async function safeGetItem(key) {
  try {
    const val = await storageAdapter.getItem(key);
    log(`getItem(${key}) ->`, val ? 'valor' : 'null');
    return val;
  } catch (err) {
    console.warn('⚠️ getItem falló:', err?.message || err);
    return memoryStore.get(key) ?? null;
  }
}

async function safeSetItem(key, value) {
  try {
    log(`setItem(${key}) bytes=`, value?.length ?? 0);
    return await storageAdapter.setItem(key, value);
  } catch (err) {
    console.warn('⚠️ setItem falló:', err?.message || err);
    memoryStore.set(key, value);
  }
}

// Nuevo key versionado + key legado para migración
const STORAGE_KEY = 'formularios_offline_v1';
const LEGACY_KEYS = ['formularios_locales']; // tu key anterior

// -------- helpers --------
const safeParse = (str, fallback) => {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
};
const safeStringify = (obj) => {
  try { return JSON.stringify(obj); } catch { return '[]'; }
};
const nowISO = () => new Date().toISOString();
const randomId = () => `fl_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

// Migra datos de keys viejos -> nuevo key (idempotente)
async function migrateIfNeeded() {
  const current = await safeGetItem(STORAGE_KEY);
  if (current) return; // ya hay data en el nuevo key

  for (const k of LEGACY_KEYS) {
    const legacy = await safeGetItem(k);
    if (!legacy) continue;

    const arr = safeParse(legacy, []);
    // Normaliza objetos (añade metadatos mínimos)
    const migrated = arr.map((f) => ({
      _id_local: f._id_local || f.id || randomId(),
      _created_at: f._created_at || nowISO(),
      _updated_at: nowISO(),
      _sync: f._sync || { status: 'pending', tries: 0, error: null },
      ...f,
    }));

    await safeSetItem(STORAGE_KEY, safeStringify(migrated));
    // No borro el legacy por si necesitas rollback; si quieres, descomenta:
    // await AsyncStorage.removeItem(k);
    return;
  }

  // si no había legacy, asegura arreglo vacío
  await safeSetItem(STORAGE_KEY, '[]');
}

async function readAll() {
  await migrateIfNeeded();
  const raw = await safeGetItem(STORAGE_KEY);
  const arr = safeParse(raw, []);
  // Ordenar más recientes primero por _created_at o id numérico como fallback
  return arr.sort((a, b) => {
    const ad = a._created_at || '';
    const bd = b._created_at || '';
    if (ad && bd) return bd.localeCompare(ad);
    const ai = typeof a.id === 'number' ? a.id : 0;
    const bi = typeof b.id === 'number' ? b.id : 0;
    return bi - ai;
  });
}

async function writeAll(arr) {
  const safeArr = Array.isArray(arr) ? arr : [];
  await safeSetItem(STORAGE_KEY, safeStringify(safeArr));
  return safeArr;
}

// -------- API compatible + mejoras --------

/**
 * Guarda o actualiza un formulario local.
 * - Si no trae _id_local, se genera.
 * - Añade metadatos: _created_at, _updated_at, _sync.
 * - Mantiene compatibilidad con tu `id` numérico actual si viene.
 */
export async function guardarFormularioLocal(formulario) {
  try {
    log('guardarFormularioLocal inicio');
    if (!formulario || typeof formulario !== 'object') {
      throw new Error('Formulario inválido');
    }

    const list = await readAll();
    // ID local único
    const _id_local = formulario._id_local || randomId();

    // Si viene id de servidor (uuid) lo guardamos aparte para trazabilidad
    const serverId = formulario.id && typeof formulario.id === 'string' && formulario.id.length > 20
      ? formulario.id
      : null;

    const idx = list.findIndex(f => (f._id_local === _id_local) || (serverId && f.id === serverId));

    const baseMeta = {
      _id_local,
      _created_at: nowISO(),
      _updated_at: nowISO(),
      _sync: { status: 'pending', tries: 0, error: null, photo: 'unknown' }, // photo: pending|uploaded|unknown
    };

    const nuevo = {
      ...baseMeta,
      ...formulario,
      ...(serverId ? { id: serverId } : {}),
    };

    if (idx !== -1) {
      // update
      list[idx] = { ...list[idx], ...nuevo, _updated_at: nowISO() };
    } else {
      list.unshift(nuevo); // al inicio por reciente
    }

    await writeAll(list);
    log('guardarFormularioLocal ok, total=', list.length);
    return nuevo._id_local;
  } catch (error) {
    console.error('❌ Error al guardar formulario local:', error);
    throw error;
  }
}

export async function obtenerFormulariosLocales() {
  try {
    return await readAll();
  } catch (error) {
    console.error('❌ Error al obtener formularios locales:', error);
    return [];
  }
}

export async function eliminarFormularioLocal(idOrLocalId) {
  try {
    const list = await readAll();
    const nueva = list.filter(item =>
      item._id_local !== idOrLocalId && item.id !== idOrLocalId
    );
    await writeAll(nueva);
  } catch (error) {
    console.error('❌ Error al eliminar formulario local:', error);
    throw error;
  }
}

export async function limpiarFormulariosLocales() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, '[]');
  } catch (error) {
    console.error('❌ Error al limpiar formularios locales:', error);
    throw error;
  }
}

export async function contarFormulariosLocales() {
  try {
    const list = await readAll();
    return list.length;
  } catch (error) {
    console.error('❌ Error al contar formularios locales:', error);
    return 0;
  }
}

// -------- utilidades extra para sincronización (opcionales) --------

/** Devuelve un formulario por _id_local o id de servidor */
export async function obtenerFormularioPorId(idOrLocalId) {
  const list = await readAll();
  return list.find(f => f._id_local === idOrLocalId || f.id === idOrLocalId) || null;
}

/** Aplica un patch a un formulario local identificado por _id_local o id de servidor */
export async function actualizarFormularioLocal(idOrLocalId, patch = {}) {
  const list = await readAll();
  const idx = list.findIndex(f => f._id_local === idOrLocalId || f.id === idOrLocalId);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...patch, _updated_at: nowISO() };
  await writeAll(list);
  return true;
}

/**
 * Marca como sincronizado y reemplaza id local por id de servidor (uuid).
 * Guarda status de foto si pasas `foto_url` remota.
 */
export async function marcarSincronizado(idLocal, serverId, { fotoUrlRemota } = {}) {
  const list = await readAll();
  const idx = list.findIndex(f => f._id_local === idLocal || f.id === idLocal);
  if (idx === -1) return false;

  list[idx] = {
    ...list[idx],
    id: serverId || list[idx].id, // conserva si ya la tenía
    _sync: { status: 'synced', tries: (list[idx]._sync?.tries || 0), error: null, photo: fotoUrlRemota ? 'uploaded' : (list[idx]._sync?.photo || 'unknown') },
    foto_url: fotoUrlRemota || list[idx].foto_url,
    _updated_at: nowISO(),
  };

  await writeAll(list);
  return true;
}

/** Incrementa contador de intentos y guarda último error de sync */
export async function marcarErrorSync(idOrLocalId, errorMsg) {
  const list = await readAll();
  const idx = list.findIndex(f => f._id_local === idOrLocalId || f.id === idOrLocalId);
  if (idx === -1) return false;
  const tries = (list[idx]._sync?.tries || 0) + 1;
  list[idx] = { ...list[idx], _sync: { ...(list[idx]._sync || {}), status: 'pending', tries, error: String(errorMsg || '') }, _updated_at: nowISO() };
  await writeAll(list);
  return true;
}
