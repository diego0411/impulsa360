// lib/upload.js
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Comprime/redimensiona a JPEG y sube una imagen a Supabase Storage (mobile).
 * Devuelve el PATH almacenado (no URL pública).
 * @param {string} uri - URI local de la imagen (file://)
 * @param {string} path - Ruta destino dentro del bucket (ej: activaciones/<id>.jpg)
 * @returns {Promise<string|null>} path o null si falla
 */
export const subirImagenASupabase = async (uri, path) => {
  try {
    if (!uri || !path) return null;
    const bucket = 'fotos-activaciones';

    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists || !fileInfo.size) {
      console.error('❌ El archivo no existe o está vacío');
      return null;
    }

    // Comprime a JPEG y redimensiona (máx 1600px)
    const manip = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1600 } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
    );

    const base64 = await FileSystem.readAsStringAsync(manip.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const arrayBuffer = decode(base64);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
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
  }
};
