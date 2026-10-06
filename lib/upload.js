// lib/upload.js
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import { withTimeout } from './asyncTimeout';
import { v4 as uuidv4 } from 'uuid';
import { decode } from 'base64-arraybuffer';
import { crearCodigoErrorFoto, registrarErrorFoto } from './photoDiagnostics';

export const ACTIVACIONES_BUCKET = 'fotos-activaciones';
const FILE_TIMEOUT_MS = 12000;
const STORAGE_TIMEOUT_MS = 45000;
const MANIPULATE_TIMEOUT_MS = 30000;
const MAX_IMAGEN_BYTES = 6 * 1024 * 1024;
// Presupuesto de píxeles previo al manipulate: ImageManipulator decodifica el
// bitmap full-resolution (N px × 4B ARGB) ANTES del resize. 12MP ≈ 48MB.
const MAX_IMAGEN_PIXELES = 12000000;
const PENDING_PHOTOS_DIR = 'activaciones-pendientes';
const FILE_WRITE_TIMEOUT_MS = 15000;

const makeTempFileUri = (extension = 'jpg') =>
  `${FileSystem.cacheDirectory || FileSystem.documentDirectory}upload-temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;

const pendingPhotosBaseDir = () => (FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${PENDING_PHOTOS_DIR}` : '');

// UNA FOTO = MÁXIMO UNA OPERACIÓN VIVA: mapa de uploads en vuelo por path.
// Todos los disparadores comparten la misma promesa; no se crean superpuestos.
const uploadsEnVuelo = new Map();

// Registro de fotos en procesamiento/limpieza para no borrarlas por error.
const fotosEnProceso = new Set();
export const marcarFotoEnProceso = (uri) => {
  if (typeof uri === 'string' && uri) fotosEnProceso.add(uri);
};
export const liberarFotoEnProceso = (uri) => {
  if (typeof uri === 'string') fotosEnProceso.delete(uri);
};
export const isFotoEnProceso = (uri) => fotosEnProceso.has(uri);

const uploadErrorInfo = (error) => ({
  message: error?.message || String(error || 'Error desconocido'),
  code: error?.code ?? null,
  details: error?.details ?? null,
  hint: error?.hint ?? null,
  status: error?.status ?? error?.statusCode ?? null,
});

const uploadErrorLog = (context, error) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.error('[upload]', context, uploadErrorInfo(error));
  }
};

const uploadDebug = (...args) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[upload]', ...args);
  }
};

const buildUploadError = (context, error) => {
  const info = uploadErrorInfo(error);
  const details = [
    info.message,
    info.code ? `code=${info.code}` : '',
    info.status ? `status=${info.status}` : '',
    info.details ? `details=${info.details}` : '',
    info.hint ? `hint=${info.hint}` : '',
  ].filter(Boolean).join(' | ');
  return new Error(`${context}: ${details || 'Error desconocido'}`);
};

const buildPhotoSyncError = (code, context, error) => {
  const syncError = buildUploadError(context, error);
  syncError.photoSyncCode = code;
  syncError.code = error?.code ?? null;
  syncError.status = error?.status ?? error?.statusCode ?? null;
  syncError.causeName = error?.name || null;
  return syncError;
};

const toFileUri = async (uri) => {
  if (!uri) return '';
  if (/^file:\/\//i.test(uri)) return uri;

  // Algunos dispositivos devuelven content://; lo copiamos a cache para procesarlo.
  if (/^content:\/\//i.test(uri)) {
    const tempUri = makeTempFileUri('jpg');
    await withTimeout(
      FileSystem.copyAsync({ from: uri, to: tempUri }),
      FILE_WRITE_TIMEOUT_MS,
      'La copia local de la foto excedió el tiempo permitido.'
    );
    return tempUri;
  }

  return uri;
};

const getImageSize = (uri) => new Promise((resolve, reject) => {
  Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
});

export const prepararImagenPersistente = async (uri, fieldName = 'foto') => {
  let sourceUri = '';
  let tempUri = '';
  let stage = 'persist';
  try {
    uploadDebug('uri original', { fieldName, uri });
    if (!/^(file|content):\/\//i.test(uri || '')) {
      throw buildUploadError('Formato de imagen no soportado', {
        message: String(uri || '').slice(0, 80),
      });
    }
    sourceUri = await toFileUri(uri);
    const preInfo = await withTimeout(
      FileSystem.getInfoAsync(sourceUri, { size: true }),
      FILE_TIMEOUT_MS,
      'La foto tardó demasiado en leerse.'
    ).catch(() => null);
    if (!preInfo?.exists) {
      throw buildUploadError('No se pudo leer la imagen seleccionada', {
        message: sourceUri,
      });
    }
    if (typeof preInfo.size === 'number' && preInfo.size <= 0) {
      throw buildUploadError('La imagen seleccionada está vacía', {
        message: sourceUri,
      });
    }
    if (typeof preInfo.size === 'number' && preInfo.size > MAX_IMAGEN_BYTES) {
      throw buildUploadError('Imagen demasiado grande (≤ 6 MB)', {
        message: sourceUri,
        status: preInfo.size,
      });
    }
    // Una sola decodificación: getSize solo lee dimensiones, manipulate hace
    // resize+compress en un único paso para no retener varios bitmaps.
    stage = 'manipulate';
    const { width, height } = await withTimeout(
      getImageSize(sourceUri),
      MANIPULATE_TIMEOUT_MS,
      'No se pudo procesar la imagen.'
    ).catch(() => ({ width: 0, height: 0 }));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw buildUploadError('No se pudo procesar la imagen', {
        message: sourceUri,
      });
    }
    if (Math.max(width, height) > 16000) {
      throw buildUploadError('Imagen demasiado grande (≤ 6 MB)', {
        message: sourceUri,
        status: preInfo.size,
      });
    }
    // Gate OOM: rechazar ANTES de manipulateAsync usando las dimensiones ya
    // obtenidas por Image.getSize (barato, solo headers). La imagen rechazada
    // nunca se decodifica ni manipula; el caller muestra el mensaje al usuario.
    const totalPixeles = width * height;
    if (totalPixeles > MAX_IMAGEN_PIXELES) {
      throw buildUploadError('La foto tiene una resolución demasiado alta. Configura la cámara en 12 MP o menos e inténtalo nuevamente.', {
        message: sourceUri,
        status: totalPixeles,
      });
    }
    // Reducción robusta sin segundo onCameraReady/pictureSize: un solo
    // manipulate. >8MP sale a 1024 para bajar pico y peso; resto a 1280.
    const ladoSalida = totalPixeles > 8000000 ? 1024 : 1280;
    const resize = Math.max(width, height) > ladoSalida
      ? (width >= height ? { width: ladoSalida } : { height: ladoSalida })
      : null;
    const manipulada = await withTimeout(
      ImageManipulator.manipulateAsync(sourceUri, resize ? [{ resize }] : [], {
        compress: 0.5,
        format: ImageManipulator.SaveFormat.JPEG,
      }),
      MANIPULATE_TIMEOUT_MS,
      'No se pudo procesar la imagen.'
    );
    tempUri = manipulada.uri;
    stage = 'persist';
    if (!FileSystem.documentDirectory) {
      throw buildUploadError('No se pudo guardar la foto en almacenamiento persistente', {
        message: 'documentDirectory no disponible',
      });
    }
    const baseDir = pendingPhotosBaseDir();
    await withTimeout(
      FileSystem.makeDirectoryAsync(baseDir, { intermediates: true }),
      FILE_WRITE_TIMEOUT_MS,
      'La preparación del almacenamiento local excedió el tiempo permitido.'
    );
    const destination = `${baseDir}/${uuidv4()}.jpg`;
    await withTimeout(
      FileSystem.copyAsync({ from: tempUri, to: destination }),
      FILE_WRITE_TIMEOUT_MS,
      'El guardado local de la foto excedió el tiempo permitido.'
    );
    const persistedInfo = await withTimeout(
      FileSystem.getInfoAsync(destination, { size: true }),
      FILE_TIMEOUT_MS,
      'La foto tardó demasiado en guardarse.'
    );
    if (!persistedInfo?.exists || (typeof persistedInfo.size === 'number' && persistedInfo.size <= 0)) {
      throw buildUploadError('No se pudo guardar la foto en el dispositivo', {
        message: destination,
        status: persistedInfo?.size,
      });
    }
    uploadDebug('uri persistente', { fieldName, sourceUri, destination });
    return destination;
  } catch (error) {
    const code = await registrarErrorFoto(stage, error);
    const photoError = error instanceof Error ? error : new Error(String(error || 'Error de foto'));
    photoError.photoCode = code || crearCodigoErrorFoto(stage, photoError);
    throw photoError;
  } finally {
    if (tempUri) {
      await withTimeout(
        FileSystem.deleteAsync(tempUri, { idempotent: true }),
        FILE_WRITE_TIMEOUT_MS,
        'La limpieza temporal excedió el tiempo permitido.'
      ).catch(() => {});
    }
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri)) {
      await withTimeout(
        FileSystem.deleteAsync(sourceUri, { idempotent: true }),
        FILE_WRITE_TIMEOUT_MS,
        'La limpieza temporal excedió el tiempo permitido.'
      ).catch(() => {});
    }
  }
};

export const esFotoPendientePersistente = (uri) => (
  typeof uri === 'string'
  && !!FileSystem.documentDirectory
  && uri.startsWith(`${pendingPhotosBaseDir()}/`)
);

export const limpiarFotosPendientesHuerfanas = async (referencedUris = []) => {
  const baseDir = pendingPhotosBaseDir();
  if (!baseDir) return { deleted: 0 };

  const referenced = new Set(
    (Array.isArray(referencedUris) ? referencedUris : [])
      .filter((uri) => typeof uri === 'string' && uri.startsWith(`${baseDir}/`))
  );

  const dirInfo = await FileSystem.getInfoAsync(baseDir).catch(() => null);
  if (!dirInfo?.exists || !dirInfo.isDirectory) return { deleted: 0 };

  const files = await FileSystem.readDirectoryAsync(baseDir).catch(() => []);
  let deleted = 0;
  for (const fileName of files) {
    const uri = `${baseDir}/${fileName}`;
    if (referenced.has(uri)) continue;
    if (fotosEnProceso.has(uri)) continue;
    if (uploadsEnVuelo.size > 0 && [...uploadsEnVuelo.values()].some(() => false)) continue;
    await FileSystem.deleteAsync(uri, { idempotent: true }).then(() => {
      deleted += 1;
    }).catch(() => {});
  }
  return { deleted };
};

// Limpieza bounded y segura: solo no referenciadas, suficientemente
// antiguas, nunca en proceso, con límite de trabajo por ejecución.
export const limpiarFotosHuerfanasSegura = async ({
  referencedUris = [],
  maxAgeMs = 24 * 60 * 60 * 1000,
  maxFiles = 20,
} = {}) => {
  const baseDir = pendingPhotosBaseDir();
  if (!baseDir) return { deleted: 0, scanned: 0 };
  const referenced = new Set(
    (Array.isArray(referencedUris) ? referencedUris : [])
      .filter((uri) => typeof uri === 'string' && uri.startsWith(`${baseDir}/`))
  );
  const dirInfo = await FileSystem.getInfoAsync(baseDir).catch(() => null);
  if (!dirInfo?.exists || !dirInfo.isDirectory) return { deleted: 0, scanned: 0 };
  const files = await FileSystem.readDirectoryAsync(baseDir).catch(() => []);
  const ahora = Date.now();
  let deleted = 0;
  let scanned = 0;
  for (const fileName of files) {
    if (deleted >= maxFiles) break;
    const uri = `${baseDir}/${fileName}`;
    if (referenced.has(uri)) continue;
    if (fotosEnProceso.has(uri)) continue;
    scanned += 1;
    let info = null;
    try {
      info = await FileSystem.getInfoAsync(uri).catch(() => null);
    } catch {
      info = null;
    }
    if (!info?.exists) continue;
    const mtime = info?.modificationTime ? Number(info.modificationTime) * 1000 : NaN;
    if (Number.isFinite(mtime) && ahora - mtime < maxAgeMs) continue;
    if (!Number.isFinite(mtime) && maxAgeMs > 0) continue;
    await FileSystem.deleteAsync(uri, { idempotent: true }).then(() => {
      deleted += 1;
    }).catch(() => {});
  }
  return { deleted, scanned };
};

export const asegurarFotoPendientePersistente = async (uri, fieldName = 'foto') => {
  if (!uri || !/^(file|content):\/\//i.test(uri)) return uri;
  if (/^content:\/\//i.test(uri)) return prepararImagenPersistente(uri, fieldName);
  if (esFotoPendientePersistente(uri)) return uri;
  const info = await FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
  if (!info?.exists || (typeof info.size === 'number' && info.size <= 0)) return uri;
  return prepararImagenPersistente(uri, fieldName);
};

/**
 * Convierte un path de Storage a URL pública/signed URL.
 * Si ya recibe una URL http(s), la retorna sin cambios.
 */
export const resolverUrlDeFoto = async (pathOrUrl) => {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const path = String(pathOrUrl).replace(/^\/+/, '');
  if (!path) return '';

  const { data: signedData, error } = await withTimeout(
    supabase.storage
      .from(ACTIVACIONES_BUCKET)
      .createSignedUrl(path, 60 * 60),
    STORAGE_TIMEOUT_MS,
    'La señal está muy débil para cargar la foto.'
  );
  if (!error && signedData?.signedUrl) return signedData.signedUrl;

  return '';
};

/**
 * Comprime/redimensiona a JPEG y sube una imagen a Supabase Storage (mobile).
 * Devuelve el PATH almacenado (no URL pública).
 * @param {string} uri - URI local de la imagen (file://)
 * @param {string} path - Ruta destino dentro del bucket (ej: activaciones/<id>.jpg)
 * @returns {Promise<string|null>} path o null si falla
 */
export const subirImagenASupabase = async (uri, path, { onStage } = {}) => {
  let sourceUri = '';
  let encoded = null;
  let payload = null;
  const reportStage = async (stage) => {
    if (typeof onStage === 'function') await onStage(stage).catch(() => {});
  };
  try {
    if (!uri || !path) return null;
    if (!path.startsWith('activaciones/')) {
      console.warn('⚠️ Path de upload no permitido, debe iniciar con activaciones/:', path);
      return null;
    }

    await reportStage('FOTO-LOCAL-READ');
    try {
      sourceUri = await toFileUri(uri);
    } catch (error) {
      throw buildPhotoSyncError('FOTO-LOCAL-READ', 'No se pudo preparar la foto local', error);
    }
    let fileInfo;
    try {
      fileInfo = await withTimeout(
        FileSystem.getInfoAsync(sourceUri, { size: true }),
        FILE_TIMEOUT_MS,
        'La foto tardó demasiado en leerse.'
      );
    } catch (error) {
      throw buildPhotoSyncError('FOTO-LOCAL-READ', 'No se pudo leer la foto local', error);
    }
    const size = typeof fileInfo?.size === 'number' ? fileInfo.size : null;
    if (!fileInfo?.exists || size === 0) {
      const error = buildUploadError('Archivo de foto inexistente o vacío', { message: sourceUri || uri, status: fileInfo?.size });
      uploadErrorLog('archivo inexistente o vacío', error);
      error.photoSyncCode = 'FOTO-LOCAL-READ';
      throw error;
    }
    if (size !== null && size > MAX_IMAGEN_BYTES) {
      const error = buildUploadError('Foto demasiado grande para subir (≤ 6 MB)', { message: sourceUri || uri, status: size });
      uploadErrorLog('foto excede tamaño máximo', error);
      error.photoSyncCode = 'FOTO-LOCAL-READ';
      throw error;
    }

    try {
      await reportStage('FOTO-LOCAL-READ');
      encoded = await withTimeout(
        FileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64 }),
        FILE_TIMEOUT_MS,
        'La foto tardó demasiado en leerse desde el dispositivo.'
      );
    } catch (error) {
      throw buildPhotoSyncError('FOTO-LOCAL-READ', 'No se pudo leer la foto local para subir', error);
    }
    try {
      await reportStage('FOTO-BASE64-DECODE');
      payload = decode(encoded);
      encoded = null;
    } catch (error) {
      throw buildPhotoSyncError('FOTO-BASE64-DECODE', 'No se pudo preparar la foto local para subir', error);
    }

    await reportStage('FOTO-AUTH-REFRESH');
    try {
      const { data: sessionData, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        FILE_TIMEOUT_MS,
        'La sesión tardó demasiado en validarse.'
      );
      if (sessionError || !sessionData?.session) {
        throw sessionError || new Error('Sesión autenticada no disponible.');
      }
    } catch (error) {
      throw buildPhotoSyncError('FOTO-AUTH-REFRESH', 'No se pudo validar la sesión para subir la foto', error);
    }

    await reportStage('FOTO-STORAGE-NETWORK');
    // Sin race simulado en red: se espera la resolución real del upload para
    // no dejar un request vivo mientras el retry inicia otro superpuesto.
    // La memoria se libera en cuanto la operación real termina.
    let uploadResult;
    try {
      uploadResult = await supabase.storage
        .from(ACTIVACIONES_BUCKET)
        .upload(path, payload, {
          contentType: 'image/jpeg',
          upsert: true,
        });
    } catch (error) {
      throw buildPhotoSyncError('FOTO-STORAGE-NETWORK', 'No se pudo conectar con el almacenamiento de fotos', error);
    }
    payload = null;
    encoded = null;

    const { error: uploadError } = uploadResult || {};
    if (uploadError) {
      uploadErrorLog('error supabase storage upload', uploadError);
      if (uploadError?.name === 'StorageUnknownError' || uploadError?.originalError) {
        throw buildPhotoSyncError('FOTO-STORAGE-NETWORK', 'No se pudo conectar con el almacenamiento de fotos', uploadError);
      }
      throw buildPhotoSyncError('FOTO-STORAGE-HTTP', 'El almacenamiento rechazó la foto', uploadError);
    }

    await reportStage('FOTO-STORAGE-HTTP');
    return path;
  } catch (error) {
    uploadErrorLog('error inesperado al subir imagen', error);
    throw error;
  } finally {
    // Libera referencias grandes en cuanto termina la operación real.
    encoded = null;
    payload = null;
    // Limpieza de archivos temporales creados durante el upload.
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri)) {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
    }
  }
};

// Comparte una sola promesa viva por path: si dos disparadores piden el
// mismo upload, ambos esperan la misma operación real.
export const subirImagenExclusiva = (uri, path, opts) => {
  if (!path) return subirImagenASupabase(uri, path, opts);
  const enVuelo = uploadsEnVuelo.get(path);
  if (enVuelo) return enVuelo;
  const promesa = subirImagenASupabase(uri, path, opts).finally(() => {
    if (uploadsEnVuelo.get(path) === promesa) uploadsEnVuelo.delete(path);
  });
  uploadsEnVuelo.set(path, promesa);
  return promesa;
};
