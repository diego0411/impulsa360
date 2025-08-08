// lib/upload.js
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Comprime/redimensiona a JPEG y sube una imagen a Supabase Storage (mobile).
 * @param {string} uri - URI local de la imagen (file://)
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
    console.log(`📦 Tamaño archivo original: ${sizeMB} MB`);

    // 🔧 MÍNIMO CAMBIO: convertir a JPEG comprimido y redimensionar (máx 1600px)
    const manip = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1600 } }], // mantiene proporción
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
    );

    // Lee la imagen procesada como base64 y conviértela a ArrayBuffer
    const base64 = await FileSystem.readAsStringAsync(manip.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const arrayBuffer = decode(base64);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(nombreArchivo, arrayBuffer, {
        contentType: 'image/jpeg', // coincide con la salida del manipulado
        upsert: false, // evita sobrescrituras accidentales
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
