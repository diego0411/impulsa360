// lib/upload.js
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import { decode } from 'base64-arraybuffer';
import { withTimeout } from './asyncTimeout';

export const ACTIVACIONES_BUCKET = 'fotos-activaciones';
const FILE_TIMEOUT_MS = 12000;
const STORAGE_TIMEOUT_MS = 45000;

const makeTempFileUri = (extension = 'jpg') =>
  `${FileSystem.cacheDirectory || FileSystem.documentDirectory}upload-temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;

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
  let firstUri = '';
  let secondUri = '';
  try {
    uploadDebug('uri original', { fieldName, uri });
    sourceUri = await toFileUri(uri);
    const { width, height } = await getImageSize(sourceUri);
    const resize = Math.max(width, height) > 1280
      ? (width >= height ? { width: 1280 } : { height: 1280 })
      : null;
    const first = await ImageManipulator.manipulateAsync(sourceUri, resize ? [{ resize }] : [], {
      compress: 0.6,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    firstUri = first.uri;
    const info = await FileSystem.getInfoAsync(firstUri, { size: true });
    let finalUri = firstUri;
    if ((info?.size || 0) > 400 * 1024) {
      const second = await ImageManipulator.manipulateAsync(firstUri, [], {
        compress: 0.45,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      secondUri = second.uri;
      finalUri = secondUri;
    }
    const baseDir = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}activaciones-pendientes`;
    await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
    const destination = `${baseDir}/${fieldName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    await FileSystem.copyAsync({ from: finalUri, to: destination });
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
    if (firstUri) await FileSystem.deleteAsync(firstUri, { idempotent: true }).catch(() => {});
    if (secondUri) await FileSystem.deleteAsync(secondUri, { idempotent: true }).catch(() => {});
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri)) await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
  }
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

  const { data } = supabase.storage.from(ACTIVACIONES_BUCKET).getPublicUrl(path);
  if (data?.publicUrl) return data.publicUrl;

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
    const hasZeroBytes = typeof fileInfo?.size === 'number' && fileInfo.size <= 0;
    if (!fileInfo?.exists || hasZeroBytes) {
      const error = buildUploadError('Archivo de foto inexistente o vacío', { message: sourceUri || uri, status: fileInfo?.size });
      uploadErrorLog('archivo inexistente o vacío', error);
      throw error;
    }

    const base64 = await withTimeout(
      FileSystem.readAsStringAsync(sourceUri, {
        encoding: FileSystem.EncodingType.Base64,
      }),
      FILE_TIMEOUT_MS,
      'La foto tardó demasiado en prepararse.'
    );
    const arrayBuffer = decode(base64);

    const { error: uploadError } = await withTimeout(
      supabase.storage
        .from(ACTIVACIONES_BUCKET)
        .upload(path, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        }),
      STORAGE_TIMEOUT_MS,
      'La señal está muy débil para subir la foto. Se reintentará luego.'
    );

    if (uploadError) {
      uploadErrorLog('error supabase storage upload', uploadError);
      throw buildUploadError('Error al subir foto a Supabase Storage', uploadError);
    }

    return path;
  } catch (error) {
    uploadErrorLog('error inesperado al subir imagen', error);
    throw error;
  } finally {
    // Limpieza de archivos temporales creados durante el upload.
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri)) {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
    }
  }
};
