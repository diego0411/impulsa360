import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';

/**
 * Comprime, convierte a base64 y sube una imagen a Supabase Storage.
 * @param {string} uri - URI local de la imagen
 * @returns {Promise<string|null>} URL pública o null si falla
 */
export const subirImagenASupabase = async (uri) => {
  try {
    const bucket = 'fotos-activaciones';
    const folder = 'activaciones';
    const nombreArchivo = `${folder}/imagen_${Date.now()}.jpg`;

    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists || !fileInfo.size) {
      console.error('❌ El archivo no existe o está vacío');
      return null;
    }

    const sizeMB = (fileInfo.size / 1024 / 1024).toFixed(2);
    console.log(`📦 Tamaño archivo para subir: ${sizeMB} MB`);

    if (parseFloat(sizeMB) > 2) {
      console.warn('⚠️ La imagen excede el límite recomendado de 2 MB');
    }

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const arrayBuffer = decode(base64);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(nombreArchivo, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: false, // Mejor evitar sobrescritura accidental
      });

    if (uploadError) {
      console.error('❌ Error al subir imagen:', uploadError.message);
      return null;
    }

    const { data, error: urlError } = supabase.storage
      .from(bucket)
      .getPublicUrl(nombreArchivo);

    if (urlError || !data?.publicUrl) {
      console.error('❌ No se pudo obtener la URL pública:', urlError?.message || 'Desconocido');
      return null;
    }

    return data.publicUrl;
  } catch (error) {
    console.error('❌ Error inesperado al subir imagen:', error.message || error);
    return null;
  }
};
