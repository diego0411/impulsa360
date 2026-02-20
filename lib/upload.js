// lib/upload.js
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import * as ImageManipulator from 'expo-image-manipulator';

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
  let manipUri = '';
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

    // Comprime a JPEG y redimensiona (máx 1600px). Si falla, intenta con la original.
    try {
      const manip = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ resize: { width: 1600 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
      );
      manipUri = manip?.uri || '';
    } catch (manipError) {
      console.warn('⚠️ No se pudo comprimir imagen, se intenta archivo original:', manipError?.message || manipError);
    }

    const uploadUri = manipUri || sourceUri;
    const base64 = await FileSystem.readAsStringAsync(uploadUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const arrayBuffer = decode(base64);

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
    if (manipUri && manipUri.startsWith('file://')) {
      await FileSystem.deleteAsync(manipUri, { idempotent: true }).catch(() => {});
    }
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri)) {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
    }
  }
};
