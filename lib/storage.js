// lib/storage.js
import { Platform } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { leerRegistroSeguro, secureLocalStorage } from './secureLocalStorage';

const memoryStore = new Map();
let mutationQueue = Promise.resolve();
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
const log = (...args) => {
  if (isDev) {
    console.log('📦 storage:', ...args);
  }
};

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
      async removeItem(k) {
        return globalThis.localStorage.removeItem(k);
      },
    };
  }
  log('Usando AsyncStorage como backend');
  return {
    async getItem(k) {
      return secureLocalStorage.getItem(k);
    },
    async setItem(k, v) {
      return secureLocalStorage.setItem(k, v);
    },
    async removeItem(k) {
      return secureLocalStorage.removeItem(k);
    },
  };
})();

async function safeGetItem(key) {
  if (memoryStore.has(key)) {
    return memoryStore.get(key);
  }
  try {
    const val = await storageAdapter.getItem(key);
    log(`getItem(${key}) ->`, val ? 'valor' : 'null');
    return val;
  } catch (err) {
    if (isDev) {
      console.warn('⚠️ getItem falló:', err?.message || err);
    }
    return memoryStore.get(key) ?? null;
  }
}

async function safeSetItem(key, value) {
  log(`setItem(${key}) bytes=`, value?.length ?? 0);
  try {
    const result = await storageAdapter.setItem(key, value);
    if (result === false) {
      throw new Error('No se pudo persistir el valor local de forma segura.');
    }
    memoryStore.delete(key);
    return true;
  } catch (err) {
    if (isDev) {
      console.warn('⚠️ setItem falló:', err?.message || err);
    }
    // Se conserva copia en memoria solo como lectura temporal; el error se
    // propaga para que el llamador NUNCA confirme un guardado no durable.
    memoryStore.set(key, value);
    throw err instanceof Error ? err : new Error('No se pudo persistir el valor local.');
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
const randomId = () => uuidv4();
const isUuid = (value) =>
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isLocalFileUri = (value) => typeof value === 'string' && /^file:\/\//i.test(value);
const getLocalPhotos = (formulario = {}) => {
  const current = formulario?._sync?.localPhotos || {};
  return {
    ...current,
    ...(isLocalFileUri(formulario.foto_url) ? { foto_url: formulario.foto_url } : {}),
    ...(isLocalFileUri(formulario.foto_cash_in) ? { foto_cash_in: formulario.foto_cash_in } : {}),
  };
};
const enqueueMutation = (operation) => {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.catch(() => {});
  return next;
};

// Migra datos de keys viejos -> nuevo key (idempotente, no destructiva).
// NUNCA sobrescribe un ciphertext temporalmente ilegible o corrupto con [].
async function migrateIfNeeded() {
  if (Platform.OS !== 'web') {
    const detalle = await leerRegistroSeguro(STORAGE_KEY);
    if (detalle.status === 'temporarily_unreadable' || detalle.status === 'corrupt') {
      // No tocar el almacenamiento: el llamador debe abortar antes de
      // reescribir y preservar la evidencia para recuperación posterior.
      throw new Error(
        detalle.status === 'corrupt'
          ? 'Almacenamiento local ilegible: se conserva sin sobrescribir.'
          : 'Almacenamiento local temporalmente inaccesible: se reintentará luego.'
      );
    }
    if (detalle.status === 'ok' && detalle.value) return; // ya hay data
  } else {
    const current = await safeGetItem(STORAGE_KEY);
    if (current) return;
  }

  for (const k of LEGACY_KEYS) {
    const legacy = await safeGetItem(k);
    if (!legacy) continue;

    const arr = safeParse(legacy, []);
    // Normaliza objetos (añade metadatos mínimos)
    const migrated = arr.map((f) => ({
      ...f,
      _id_local: isUuid(f._id_local)
        ? f._id_local
        : isUuid(f.id)
          ? f.id
          : randomId(),
      _created_at: f._created_at || nowISO(),
      _updated_at: nowISO(),
      _sync: f._sync || { status: 'pending', tries: 0, error: null },
    }));

    await safeSetItem(STORAGE_KEY, safeStringify(migrated));
    // No borro el legacy por si necesitas rollback.
    return;
  }

  // Solo cuando se confirmó ausencia real se inicializa el arreglo vacío.
  const confirmacion = Platform.OS === 'web'
    ? { status: 'absent' }
    : await leerRegistroSeguro(STORAGE_KEY);
  if (confirmacion.status === 'absent') {
    await safeSetItem(STORAGE_KEY, '[]');
  }
}

async function readAll() {
  await migrateIfNeeded();
  if (Platform.OS !== 'web') {
    const detalle = await leerRegistroSeguro(STORAGE_KEY);
    if (detalle.status === 'temporarily_unreadable' || detalle.status === 'corrupt') {
      throw new Error('Pendientes locales no legibles en este momento.');
    }
    const arr = safeParse(detalle.value, []);
    if (!Array.isArray(arr)) throw new Error('Pendientes locales con formato inválido.');
    return arr.sort((a, b) => {
      const ad = a._created_at || '';
      const bd = b._created_at || '';
      if (ad && bd) return bd.localeCompare(ad);
      const ai = typeof a.id === 'number' ? a.id : 0;
      const bi = typeof b.id === 'number' ? b.id : 0;
      return bi - ai;
    });
  }
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
  return enqueueMutation(async () => {
    try {
      log('guardarFormularioLocal inicio');
      if (!formulario || typeof formulario !== 'object') {
        throw new Error('Formulario inválido');
      }
      if (typeof formulario.usuario_id !== 'string' || !formulario.usuario_id.trim()) {
        throw new Error('No se puede guardar una activación pendiente sin usuario propietario.');
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
        _sync: {
          status: 'pending',
          tries: 0,
          error: null,
          photo: 'unknown',
          localPhotos: getLocalPhotos(formulario),
        }, // photo: pending|uploaded|unknown
      };

      const nuevo = {
        ...baseMeta,
        ...formulario,
        _sync: {
          ...baseMeta._sync,
          ...(formulario._sync || {}),
          localPhotos: getLocalPhotos(formulario),
        },
        _id_local,
        ...(serverId ? { id: serverId } : {}),
      };

      if (idx !== -1) {
        // update
        list[idx] = {
          ...list[idx],
          ...nuevo,
          _created_at: list[idx]._created_at || nuevo._created_at,
          _updated_at: nowISO(),
        };
      } else {
        list.unshift(nuevo); // al inicio por reciente
      }

      await writeAll(list);
      log('guardarFormularioLocal ok, total=', list.length);
      return nuevo._id_local;
    } catch (error) {
      if (isDev) {
        console.error('❌ Error al guardar formulario local:', error);
      }
      throw error;
    }
  });
}

export async function obtenerFormulariosLocales() {
  try {
    return await readAll();
  } catch (error) {
    if (isDev) {
      console.error('❌ Error al obtener formularios locales:', error);
    }
    return [];
  }
}

export async function eliminarFormularioLocal(idOrLocalId) {
  return enqueueMutation(async () => {
    try {
      const list = await readAll();
      const nueva = list.filter(item =>
        item._id_local !== idOrLocalId && item.id !== idOrLocalId
      );
      await writeAll(nueva);
    } catch (error) {
      if (isDev) {
        console.error('❌ Error al eliminar formulario local:', error);
      }
      throw error;
    }
  });
}

// -------- utilidades extra para sincronización (opcionales) --------

/** Devuelve un formulario por _id_local o id de servidor */
export async function obtenerFormularioPorId(idOrLocalId) {
  const list = await readAll();
  return list.find(f => f._id_local === idOrLocalId || f.id === idOrLocalId) || null;
}

/** Aplica un patch a un formulario local identificado por _id_local o id de servidor */
export async function actualizarFormularioLocal(idOrLocalId, patch = {}) {
  return enqueueMutation(async () => {
    const list = await readAll();
    const idx = list.findIndex(f => f._id_local === idOrLocalId || f.id === idOrLocalId);
    if (idx === -1) return false;
    list[idx] = { ...list[idx], ...patch, _updated_at: nowISO() };
    await writeAll(list);
    return true;
  });
}

/** Incrementa contador de intentos y guarda último error de sync */
export async function marcarErrorSync(idOrLocalId, errorMsg, syncPatch = {}) {
  return enqueueMutation(async () => {
    const list = await readAll();
    const idx = list.findIndex(f => f._id_local === idOrLocalId || f.id === idOrLocalId);
    if (idx === -1) return false;
    const tries = (list[idx]._sync?.tries || 0) + 1;
    list[idx] = {
      ...list[idx],
      _sync: {
        ...(list[idx]._sync || {}),
        ...syncPatch,
        status: 'pending',
        tries,
        error: String(errorMsg || ''),
      },
      _updated_at: nowISO(),
    };
    await writeAll(list);
    return true;
  });
}
