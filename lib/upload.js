import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Comprime, redimensiona y sube una imagen a Supabase Storage.
 * @param {string} uri - URI local de la imagen
 * @returns {Promise<string|null>} URL pública o null si falla
 */
export const subirImagenASupabase = async (uri) => {
  try {
    const bucket = 'fotos-activaciones';
    const maxFileSizeMB = 1.5;
    const maxWidth = 1024;

    // 1️⃣ Obtener dimensiones originales
    const manipInicial = await ImageManipulator.manipulateAsync(uri, [], { base64: false });
    const { width, height } = manipInicial;

    let nuevoAncho = width;
    let nuevoAlto = height;

    // 2️⃣ Redimensionar si es más ancha de lo permitido
    if (width > maxWidth) {
      const ratio = maxWidth / width;
      nuevoAncho = maxWidth;
      nuevoAlto = Math.round(height * ratio);
    }

    // 3️⃣ Comprimir + Redimensionar
    const manipResult = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: nuevoAncho, height: nuevoAlto } }],
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    // 4️⃣ Verificar tamaño
    const fileInfo = await FileSystem.getInfoAsync(manipResult.uri);
    const sizeInMB = fileInfo.size / (1024 * 1024);
    if (sizeInMB > maxFileSizeMB) {
      alert(`La imagen es muy grande (${sizeInMB.toFixed(2)}MB). Máximo: ${maxFileSizeMB}MB`);
      return null;
    }

    // 5️⃣ Leer como base64 y convertir
    const base64 = await FileSystem.readAsStringAsync(manipResult.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const arrayBuffer = decode(base64);
    const nombreArchivo = `imagen_${Date.now()}.jpg`;

    // 6️⃣ Subir a Supabase
    const { error } = await supabase.storage
      .from(bucket)
      .upload(nombreArchivo, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) throw error;

    // 7️⃣ Obtener URL pública
    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(nombreArchivo);

    return data.publicUrl;
  } catch (error) {
    console.error('❌ Error al subir imagen:', error.message);
    return null;
  }
};
