// lib/upload.js
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import { withTimeout } from './asyncTimeout';
import { v4 as uuidv4 } from 'uuid';

export const ACTIVACIONES_BUCKET = 'fotos-activaciones';
const FILE_TIMEOUT_MS = 12000;
const STORAGE_TIMEOUT_MS = 45000;
const MANIPULATE_TIMEOUT_MS = 30000;
const MAX_IMAGEN_BYTES = 6 * 1024 * 1024;
const PENDING_PHOTOS_DIR = 'activaciones-pendientes';

const makeTempFileUri = (extension = 'jpg') =>
  `${FileSystem.cacheDirectory || FileSystem.documentDirectory}upload-temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;

const pendingPhotosBaseDir = () => (FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${PENDING_PHOTOS_DIR}` : '');

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

const toFileUri = async (uri) => {
  if (!uri) return '';
  if (/^file:\/\//i.test(uri)) return uri;

  // Algunos dispositivos devuelven content://; lo copiamos a cache para procesarlo.
  if (/^content:\/\//i.test(uri)) {
    const tempUri = makeTempFileUri('jpg');
    await FileSystem.copyAsync({ from: uri, to: tempUri });
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
      });
    }
    const resize = Math.max(width, height) > 1280
      ? (width >= height ? { width: 1280 } : { height: 1280 })
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
    if (!FileSystem.documentDirectory) {
      throw buildUploadError('No se pudo guardar la foto en almacenamiento persistente', {
        message: 'documentDirectory no disponible',
      });
    }
    const baseDir = pendingPhotosBaseDir();
    await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
    const destination = `${baseDir}/${uuidv4()}.jpg`;
    await FileSystem.copyAsync({ from: tempUri, to: destination });
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
  } finally {
    if (tempUri) await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri)) await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
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
  await Promise.all(files.map(async (fileName) => {
    const uri = `${baseDir}/${fileName}`;
    if (referenced.has(uri)) return;
    await FileSystem.deleteAsync(uri, { idempotent: true }).then(() => {
      deleted += 1;
    }).catch(() => {});
  }));
  return { deleted };
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
export const subirImagenASupabase = async (uri, path) => {
  let sourceUri = '';
  let payload = null;
  try {
    if (!uri || !path) return null;
    if (!path.startsWith('activaciones/')) {
      console.warn('⚠️ Path de upload no permitido, debe iniciar con activaciones/:', path);
      return null;
    }

    sourceUri = await toFileUri(uri);
    const fileInfo = await withTimeout(
      FileSystem.getInfoAsync(sourceUri, { size: true }),
      FILE_TIMEOUT_MS,
      'La foto tardó demasiado en leerse.'
    );
    const size = typeof fileInfo?.size === 'number' ? fileInfo.size : null;
    if (!fileInfo?.exists || size === 0) {
      const error = buildUploadError('Archivo de foto inexistente o vacío', { message: sourceUri || uri, status: fileInfo?.size });
      uploadErrorLog('archivo inexistente o vacío', error);
      throw error;
    }
    if (size !== null && size > MAX_IMAGEN_BYTES) {
      const error = buildUploadError('Foto demasiado grande para subir (≤ 6 MB)', { message: sourceUri || uri, status: size });
      uploadErrorLog('foto excede tamaño máximo', error);
      throw error;
    }

    // Una sola copia en memoria: blob nativo directo vía fetch, sin string
    // Base64 intermedio (antes convivían base64 + ArrayBuffer + copia FS).
    const fetched = await withTimeout(
      fetch(sourceUri),
      FILE_TIMEOUT_MS,
      'La foto tardó demasiado en leerse.'
    );
    payload = await withTimeout(
      fetched.blob(),
      FILE_TIMEOUT_MS,
      'La foto tardó demasiado en prepararse.'
    );

    const { error: uploadError } = await withTimeout(
      supabase.storage
        .from(ACTIVACIONES_BUCKET)
        .upload(path, payload, {
          contentType: 'image/jpeg',
          upsert: true,
        }),
      STORAGE_TIMEOUT_MS,
      'La señal está muy débil para subir la foto. Se reintentará luego.'
    );
    payload = null;

    if (uploadError) {
      uploadErrorLog('error supabase storage upload', uploadError);
      throw buildUploadError('Error al subir foto a Supabase Storage', uploadError);
    }

    return path;
  } catch (error) {
    uploadErrorLog('error inesperado al subir imagen', error);
    throw error;
  } finally {
    payload = null;
    // Limpieza de archivos temporales creados durante el upload.
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri)) {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
    }
  }
};
