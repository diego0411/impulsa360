// lib/upload.js
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';

export const ACTIVACIONES_BUCKET = 'fotos-activaciones';

const makeTempFileUri = (extension = 'jpg') =>
  `${FileSystem.cacheDirectory || FileSystem.documentDirectory}upload-temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;

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

  const { data: signedData, error } = await supabase.storage
    .from(ACTIVACIONES_BUCKET)
    .createSignedUrl(path, 60 * 60);
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
    const fileInfo = await FileSystem.getInfoAsync(sourceUri, { size: true });
    const hasZeroBytes = typeof fileInfo?.size === 'number' && fileInfo.size <= 0;
    if (!fileInfo?.exists || hasZeroBytes) {
      console.error('❌ El archivo no existe o está vacío:', sourceUri || uri);
      return null;
    }

    const uploadUri = sourceUri;
    const response = await fetch(uploadUri);
    const arrayBuffer = await response.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from(ACTIVACIONES_BUCKET)
      .upload(path, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('❌ Error al subir imagen:', uploadError.message);
      return null;
    }

    return path;
  } catch (error) {
    console.error('❌ Error inesperado al subir imagen:', error.message || error);
    return null;
  } finally {
    // Limpieza de archivos temporales creados durante el upload.
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri)) {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
    }
  }
};
