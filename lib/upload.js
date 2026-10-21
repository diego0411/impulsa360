// lib/upload.js
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import { decode } from 'base64-arraybuffer';
import { TimeoutError, withTimeout } from './asyncTimeout';
import { v4 as uuidv4 } from 'uuid';
import { crearCodigoErrorFoto, crearIdProcesamientoFoto, registrarErrorFoto, registrarHitoProcesamientoFoto } from './photoDiagnostics';
import { SUPABASE_KEY, SUPABASE_URL } from './config';
import { recordPhotoDiagnostic } from './telemetry';

export const ACTIVACIONES_BUCKET = 'fotos-activaciones';
const FILE_TIMEOUT_MS = 12000;
const STORAGE_TIMEOUT_MS = 45000;
const UPLOAD_CANCEL_GRACE_MS = 10000;
// Espera máxima a que la tarea nativa anterior de un mismo path se asiente
// antes de rechazar un nuevo intento (nunca se inicia un segundo escritor).
const UPLOAD_RESERVA_ESPERA_MS = 15000;
const MANIPULATE_TIMEOUT_MS = 30000;
const MAX_IMAGEN_BYTES = 6 * 1024 * 1024;
// Presupuesto de píxeles previo al manipulate: ImageManipulator decodifica el
// bitmap full-resolution (N px × 4B ARGB) ANTES del resize. 12MP ≈ 48MB.
const MAX_IMAGEN_PIXELES = 12000000;
const PENDING_PHOTOS_DIR = 'activaciones-pendientes';
const FILE_WRITE_TIMEOUT_MS = 15000;
const IMAGE_HEADER_BYTES = 32;
const JPEG_MIN_BYTES = 4;

const makeTempFileUri = (extension = 'jpg') =>
  `${FileSystem.cacheDirectory || FileSystem.documentDirectory}upload-temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;

const pendingPhotosBaseDir = () => (FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${PENDING_PHOTOS_DIR}` : '');
const storageObjectUrl = (bucket, path) =>
  `${String(SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/${bucket}/${path}`;
const photoSizeBucketLocal = (bytes) => {
  const v = Number(bytes);
  if (!Number.isFinite(v) || v <= 0) return 'unknown';
  if (v < 512 * 1024) return '<0.5MB';
  if (v < 2 * 1024 * 1024) return '0.5-2MB';
  if (v < 6 * 1024 * 1024) return '2-6MB';
  return '>6MB';
};

// UNA FOTO = MÁXIMO UNA OPERACIÓN VIVA: mapa de uploads en vuelo por path.
// Todos los disparadores comparten la misma promesa; no se crean superpuestos.
const uploadsEnVuelo = new Map();

// UN PATH = UN ESCRITOR NATIVO: reserva de la operación nativa real por path.
// Aunque la promesa lógica venza (timeout/cancelación), la reserva persiste
// hasta que uploadAsync() se asiente de verdad; un upload posterior espera de
// forma acotada y, si la nativa sigue viva, se rechaza sin crear otro escritor.
const uploadsNativosEnVuelo = new Map();
const MSG_RESERVA_OCUPADA = 'La subida anterior al mismo destino sigue en curso. Intenta nuevamente.';

// Registro de fotos en procesamiento/limpieza para no borrarlas por error.
const fotosEnProceso = new Set();
const fotosEnUploadNativo = new Map();
const fotosEnManipulacionNativa = new Map();
const protegerFotoEnUpload = (uri) => {
  if (typeof uri !== 'string' || !uri) return;
  fotosEnUploadNativo.set(uri, (fotosEnUploadNativo.get(uri) || 0) + 1);
};
const liberarFotoEnUpload = (uri) => {
  if (typeof uri !== 'string' || !uri) return;
  const restantes = (fotosEnUploadNativo.get(uri) || 0) - 1;
  if (restantes > 0) fotosEnUploadNativo.set(uri, restantes);
  else fotosEnUploadNativo.delete(uri);
};
const isFotoEnUploadNativo = (uri) => fotosEnUploadNativo.has(uri);
const protegerFotoEnManipulacion = (uri) => {
  if (typeof uri !== 'string' || !uri) return;
  fotosEnManipulacionNativa.set(uri, (fotosEnManipulacionNativa.get(uri) || 0) + 1);
};
const liberarFotoEnManipulacion = (uri) => {
  if (typeof uri !== 'string' || !uri) return;
  const restantes = (fotosEnManipulacionNativa.get(uri) || 0) - 1;
  if (restantes > 0) fotosEnManipulacionNativa.set(uri, restantes);
  else fotosEnManipulacionNativa.delete(uri);
};
export const marcarFotoEnProceso = (uri) => {
  if (typeof uri === 'string' && uri) fotosEnProceso.add(uri);
};
export const liberarFotoEnProceso = (uri) => {
  if (typeof uri === 'string') fotosEnProceso.delete(uri);
};
export const isFotoEnProceso = (uri) => (
  fotosEnProceso.has(uri)
  || isFotoEnUploadNativo(uri)
  || fotosEnManipulacionNativa.has(uri)
);

export const eliminarFotoTemporalSiLibre = async (uri) => {
  if (!/^file:\/\//i.test(uri || '') || isFotoEnProceso(uri)) return false;
  await FileSystem.deleteAsync(uri, { idempotent: true });
  return true;
};

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

const uploadFileBinarioConTimeout = async (url, sourceUri, options, storagePath) => {
  const pathReserva = typeof storagePath === 'string' && storagePath ? storagePath : '';
  // Espera acotada a la tarea nativa anterior del MISMO path. Si sigue viva
  // al vencer la espera, se rechaza el intento sin iniciar otro escritor.
  if (pathReserva) {
    const nativaPrevia = uploadsNativosEnVuelo.get(pathReserva);
    if (nativaPrevia) {
      try {
        await withTimeout(
          nativaPrevia.catch(() => null),
          UPLOAD_RESERVA_ESPERA_MS,
          MSG_RESERVA_OCUPADA
        );
      } catch {
        throw new TimeoutError(MSG_RESERVA_OCUPADA);
      }
      // Otro disparador pudo ganar el turno durante la espera: se rechaza
      // sin crear una segunda tarea nativa para el mismo path.
      if (uploadsNativosEnVuelo.has(pathReserva)) {
        throw new TimeoutError(MSG_RESERVA_OCUPADA);
      }
    }
  }
  const task = FileSystem.createUploadTask(url, sourceUri, options);
  let timer = null;
  let timedOut = false;
  protegerFotoEnUpload(sourceUri);
  let rawNativePromise;
  try {
    rawNativePromise = task.uploadAsync();
  } catch (error) {
    liberarFotoEnUpload(sourceUri);
    throw error;
  }
  const finalizarProteccionNativa = () => {
    if (/^file:\/\/.*upload-temp_/i.test(sourceUri)) {
      FileSystem.deleteAsync(sourceUri, { idempotent: true })
        .catch(() => {})
        .finally(() => liberarFotoEnUpload(sourceUri));
      return;
    }
    liberarFotoEnUpload(sourceUri);
  };
  const nativePromise = Promise.resolve(rawNativePromise).then(
    (result) => {
      finalizarProteccionNativa();
      return result;
    },
    (error) => {
      finalizarProteccionNativa();
      throw error;
    }
  );
  if (pathReserva) {
    // La reserva se libera únicamente cuando la operación nativa se asienta
    // (no con la promesa lógica), y solo si sigue siendo la reserva vigente.
    let reservaNativa = null;
    const liberarReserva = () => {
      if (uploadsNativosEnVuelo.get(pathReserva) === reservaNativa) {
        uploadsNativosEnVuelo.delete(pathReserva);
      }
    };
    reservaNativa = nativePromise.then(
      () => { liberarReserva(); },
      () => { liberarReserva(); }
    );
    uploadsNativosEnVuelo.set(pathReserva, reservaNativa);
  }
  let rejectTimeout;
  const timeoutSignal = new Promise((_, reject) => {
    rejectTimeout = reject;
  });
  const guardedNativePromise = nativePromise.then(
    (result) => (timedOut ? timeoutSignal : result),
    (error) => {
      if (timedOut) return timeoutSignal;
      throw error;
    }
  );
  timer = globalThis.setTimeout(() => {
    (async () => {
      timedOut = true;
      const timeoutError = new TimeoutError('La señal está muy débil para subir la foto.');
      try {
        await task.cancelAsync();
      } catch (cancelError) {
        timeoutError.cancelError = cancelError;
      }
      try {
        await withTimeout(
          nativePromise.catch(() => null),
          UPLOAD_CANCEL_GRACE_MS,
          'La cancelación de la subida tardó demasiado.'
        );
      } catch (settleError) {
        timeoutError.settleError = settleError;
      }
      rejectTimeout(timeoutError);
    })();
  }, STORAGE_TIMEOUT_MS);

  try {
    return await Promise.race([guardedNativePromise, timeoutSignal]);
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
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

const normalizarDimensionesConocidas = (width, height) => {
  const ancho = Number(width);
  const alto = Number(height);
  if (
    !Number.isSafeInteger(ancho)
    || !Number.isSafeInteger(alto)
    || ancho <= 0
    || alto <= 0
    || !Number.isSafeInteger(ancho * alto)
  ) return null;
  return { width: ancho, height: alto };
};

const coincideBytes = (bytes, offset, expected) => (
  expected.every((value, index) => bytes[offset + index] === value)
);

const leerBytesLocales = async (uri, position, length) => {
  const base64 = await withTimeout(
    FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    }),
    FILE_TIMEOUT_MS,
    'La foto tardó demasiado en identificarse.'
  );
  return new Uint8Array(decode(base64));
};

// El nombre de archivo no garantiza el formato: los respaldos anteriores
// podían conservar PNG/WebP/HEIC con sufijo .jpg.
export const detectarFormatoImagenLocal = async (uri) => {
  if (!/^file:\/\//i.test(uri || '')) return 'unknown';
  try {
    const bytes = await leerBytesLocales(uri, 0, IMAGE_HEADER_BYTES);
    if (coincideBytes(bytes, 0, [0xFF, 0xD8, 0xFF])) return 'jpeg';
    if (coincideBytes(bytes, 0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'png';
    if (coincideBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && coincideBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
    if (coincideBytes(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
      const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
      if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic';
    }
  } catch (error) {
    uploadDebug('no se pudo identificar formato local', { error: uploadErrorInfo(error) });
  }
  return 'unknown';
};

// Detecta truncamientos evidentes sin decodificar el bitmap; SOI+EOI no
// sustituye una validación completa de la estructura JPEG.
const esJpegLigeroValido = async (uri, size) => {
  if (!Number.isSafeInteger(size) || size < JPEG_MIN_BYTES) return false;
  try {
    const [inicio, fin] = await Promise.all([
      leerBytesLocales(uri, 0, 3),
      leerBytesLocales(uri, size - 2, 2),
    ]);
    return coincideBytes(inicio, 0, [0xFF, 0xD8, 0xFF])
      && coincideBytes(fin, 0, [0xFF, 0xD9]);
  } catch (error) {
    uploadDebug('no se pudo validar JPEG local', { error: uploadErrorInfo(error) });
    return false;
  }
};

const copiarFotoPendiente = async (sourceUri, suffix = '', { protectResult = false } = {}) => {
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
  const destination = `${baseDir}/${uuidv4()}${suffix}.jpg`;
  if (protectResult) marcarFotoEnProceso(destination);
  try {
    await withTimeout(
      FileSystem.copyAsync({ from: sourceUri, to: destination }),
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
  } catch (error) {
    if (protectResult) {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      liberarFotoEnProceso(destination);
    }
    throw error;
  }
  return destination;
};

export const prepararImagenPersistente = async (uri, fieldName = 'foto', options = {}) => {
  let sourceUri = '';
  let tempUri = '';
  let stage = 'persist';
  let manipulacionNativaPendiente = false;
  let manipulacionAbandonada = false;
  const processId = options.processId || crearIdProcesamientoFoto();
  try {
    uploadDebug('uri original', { fieldName, uri });
    if (!/^(file|content):\/\//i.test(uri || '')) {
      throw buildUploadError('Formato de imagen no soportado', {
        message: String(uri || '').slice(0, 80),
      });
    }
    await registrarHitoProcesamientoFoto(processId, 'PREP_START').catch(() => null);
    recordPhotoDiagnostic('PREP_START').catch(() => {});
    if (typeof options.onProcessingStarted === 'function') {
      await Promise.resolve(options.onProcessingStarted()).catch(() => {});
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
    if (
      typeof preInfo.size === 'number'
      && preInfo.size > MAX_IMAGEN_BYTES
      && options.allowLargeSourceBytes !== true
    ) {
      throw buildUploadError('Imagen demasiado grande (≤ 6 MB)', {
        message: sourceUri,
        status: preInfo.size,
      });
    }
    if (typeof options.onOriginalPersisted === 'function') {
      const originalPersistente = await copiarFotoPendiente(sourceUri, '-original');
      let originalPropiedadDelCaller = false;
      const marcarOriginalComoPropio = () => {
        originalPropiedadDelCaller = true;
      };
      try {
        await options.onOriginalPersisted(originalPersistente, marcarOriginalComoPropio);
      } catch (callbackError) {
        if (!originalPropiedadDelCaller) {
          await FileSystem.deleteAsync(originalPersistente, { idempotent: true }).catch(() => {});
        }
        throw callbackError;
      }
    }
    // Cámara y galería ya entregan dimensiones cuando están disponibles. Así
    // evitamos Image.getSize, que en Android puede decodificar con Fresco.
    stage = 'manipulate';
    const dimensionesConocidas = normalizarDimensionesConocidas(options.width, options.height);
    const { width, height } = dimensionesConocidas || await withTimeout(
      getImageSize(sourceUri),
      MANIPULATE_TIMEOUT_MS,
      'No se pudo procesar la imagen.'
    ).catch(() => ({ width: 0, height: 0 }));
    registrarHitoProcesamientoFoto(processId, 'DIMENSIONS_OK', {
      width,
      height,
      photoSizeBucket: photoSizeBucketLocal(preInfo.size),
    }).catch(() => {});
    recordPhotoDiagnostic('DIMENSIONS_OK', {
      photoSizeBucket: photoSizeBucketLocal(preInfo.size),
    }).catch(() => {});
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
    // Gate OOM: rechazar ANTES de manipulateAsync. La imagen rechazada nunca
    // se decodifica ni manipula; el caller muestra el mensaje al usuario.
    const totalPixeles = width * height;
    if (totalPixeles > MAX_IMAGEN_PIXELES) {
      const errorResolucion = buildUploadError('La foto tiene una resolución demasiado alta. Configura la cámara en 12 MP o menos e inténtalo nuevamente.', {
        message: sourceUri,
        status: totalPixeles,
      });
      errorResolucion.photoReason = 'too_large';
      throw errorResolucion;
    }
    if (options.skipManipulation === true) {
      const infoReducida = typeof preInfo.size === 'number'
        ? preInfo
        : await FileSystem.getInfoAsync(sourceUri, { size: true }).catch(() => null);
      const tamanoReducido = Number.isSafeInteger(infoReducida?.size) ? infoReducida.size : null;
      const formatoReducido = await detectarFormatoImagenLocal(sourceUri);
      if (
        tamanoReducido === null
        || formatoReducido !== 'jpeg'
        || !(await esJpegLigeroValido(sourceUri, tamanoReducido))
      ) {
        throw buildUploadError('La imagen reducida no es un JPEG válido', {
          message: sourceUri,
          status: tamanoReducido,
        });
      }
      registrarHitoProcesamientoFoto(processId, 'AFTER_MANIPULATE', { width, height }).catch(() => {});
      recordPhotoDiagnostic('AFTER_MANIPULATE').catch(() => {});
      stage = 'persist';
      const destination = await copiarFotoPendiente(sourceUri, '', {
        protectResult: options.protectResult === true,
      });
      registrarHitoProcesamientoFoto(processId, 'COPY_DONE', { width, height }).catch(() => {});
      recordPhotoDiagnostic('COPY_DONE').catch(() => {});
      uploadDebug('uri persistente', { fieldName, sourceUri, destination });
      return destination;
    }
    // Reducción robusta sin segundo onCameraReady/pictureSize: un solo
    // manipulate. >8MP sale a 1024 para bajar pico y peso; resto a 1280.
    const ladoSalida = totalPixeles > 8000000 ? 1024 : 1280;
    const resize = Math.max(width, height) > ladoSalida
      ? (width >= height ? { width: ladoSalida } : { height: ladoSalida })
      : null;
    registrarHitoProcesamientoFoto(processId, 'BEFORE_MANIPULATE', { width, height }).catch(() => {});
    recordPhotoDiagnostic('BEFORE_MANIPULATE').catch(() => {});
    protegerFotoEnManipulacion(sourceUri);
    manipulacionNativaPendiente = true;
    const promesaManipulacion = Promise.resolve().then(() => ImageManipulator.manipulateAsync(
      sourceUri,
      resize ? [{ resize }] : [],
      {
        compress: 0.5,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    ));
    promesaManipulacion.then(
      (resultadoTardio) => {
        manipulacionNativaPendiente = false;
        liberarFotoEnManipulacion(sourceUri);
        if (manipulacionAbandonada && resultadoTardio?.uri) {
          FileSystem.deleteAsync(resultadoTardio.uri, { idempotent: true }).catch(() => {});
        }
        if (manipulacionAbandonada && options.cleanupSourceAfterNative === true) {
          eliminarFotoTemporalSiLibre(sourceUri).catch(() => {});
        }
      },
      () => {
        manipulacionNativaPendiente = false;
        liberarFotoEnManipulacion(sourceUri);
        if (manipulacionAbandonada && options.cleanupSourceAfterNative === true) {
          eliminarFotoTemporalSiLibre(sourceUri).catch(() => {});
        }
      }
    );
    let manipulada;
    try {
      manipulada = await withTimeout(
        promesaManipulacion,
        MANIPULATE_TIMEOUT_MS,
        'No se pudo procesar la imagen.'
      );
    } catch (error) {
      manipulacionAbandonada = manipulacionNativaPendiente;
      throw error;
    }
    registrarHitoProcesamientoFoto(processId, 'AFTER_MANIPULATE', {
      width: manipulada.width,
      height: manipulada.height,
    }).catch(() => {});
    recordPhotoDiagnostic('AFTER_MANIPULATE').catch(() => {});
    tempUri = manipulada.uri;
    stage = 'persist';
    const destination = await copiarFotoPendiente(tempUri, '', {
      protectResult: options.protectResult === true,
    });
    registrarHitoProcesamientoFoto(processId, 'COPY_DONE', {
      width: manipulada.width,
      height: manipulada.height,
    }).catch(() => {});
    recordPhotoDiagnostic('COPY_DONE').catch(() => {});
    uploadDebug('uri persistente', { fieldName, sourceUri, destination });
    return destination;
  } catch (error) {
    const code = await registrarErrorFoto(stage, error) || crearCodigoErrorFoto(stage, error);
    recordPhotoDiagnostic(code, {
      status: 'error',
      errorCategory: code.endsWith('-TIMEOUT') ? 'timeout' : `${stage}_error`,
    }).catch(() => {});
    const photoError = error instanceof Error ? error : new Error(String(error || 'Error de foto'));
    photoError.photoCode = code;
    throw photoError;
  } finally {
    if (tempUri) {
      await withTimeout(
        FileSystem.deleteAsync(tempUri, { idempotent: true }),
        FILE_WRITE_TIMEOUT_MS,
        'La limpieza temporal excedió el tiempo permitido.'
      ).catch(() => {});
    }
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri) && !manipulacionNativaPendiente) {
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

// Verificación ligera para decidir si una evidencia local ya puede usarse.
// Solo lee cabecera y EOI; no decodifica el bitmap completo.
export const esFotoJpegPendienteValida = async (uri) => {
  if (!esFotoPendientePersistente(uri)) return false;
  const info = await FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
  if (!info?.exists || !Number.isSafeInteger(info.size) || info.size <= 0) return false;
  if (await detectarFormatoImagenLocal(uri) !== 'jpeg') return false;
  return esJpegLigeroValido(uri, info.size);
};

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
    if (isFotoEnProceso(uri)) continue;
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
    if (isFotoEnProceso(uri)) continue;
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
    const imageFormat = await detectarFormatoImagenLocal(sourceUri);
    if (imageFormat !== 'jpeg') {
      throw buildPhotoSyncError(
        'FOTO-LOCAL-FORMAT',
        'La foto local debe normalizarse a JPEG antes de sincronizarse',
        { message: `Formato detectado: ${imageFormat}` }
      );
    }
    if (!(await esJpegLigeroValido(sourceUri, size))) {
      throw buildPhotoSyncError(
        'FOTO-LOCAL-FORMAT',
        'La foto JPEG local está incompleta o no es válida para sincronizarse',
        { message: 'Faltan marcadores JPEG SOI/EOI o el archivo es demasiado corto.' }
      );
    }

    await reportStage('FOTO-AUTH-REFRESH');
    let accessToken = '';
    try {
      const { data: sessionData, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        FILE_TIMEOUT_MS,
        'La sesión tardó demasiado en validarse.'
      );
      if (sessionError || !sessionData?.session) {
        throw sessionError || new Error('Sesión autenticada no disponible.');
      }
      accessToken = sessionData.session.access_token;
    } catch (error) {
      throw buildPhotoSyncError('FOTO-AUTH-REFRESH', 'No se pudo validar la sesión para subir la foto', error);
    }
    if (!SUPABASE_URL || !SUPABASE_KEY || !accessToken) {
      throw buildPhotoSyncError('FOTO-AUTH-REFRESH', 'No se pudo validar la configuración para subir la foto', {
        message: 'Configuración o sesión no disponible.',
      });
    }

    await reportStage('FOTO-STORAGE-NETWORK');
    // Subida binaria nativa: evita materializar Base64 + ArrayBuffer en JS.
    let uploadResult;
    try {
      uploadResult = await uploadFileBinarioConTimeout(
        storageObjectUrl(ACTIVACIONES_BUCKET, path),
        sourceUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${accessToken}`,
            'content-type': 'image/jpeg',
            'cache-control': 'max-age=3600',
            'x-upsert': 'true',
          },
        },
        path
      );
    } catch (error) {
      throw buildPhotoSyncError('FOTO-STORAGE-NETWORK', 'No se pudo conectar con el almacenamiento de fotos', error);
    }

    const status = Number(uploadResult?.status || 0);
    if (status < 200 || status >= 300) {
      let storageError = { message: uploadResult?.body || 'El almacenamiento rechazó la foto', status };
      try {
        const parsed = uploadResult?.body ? JSON.parse(uploadResult.body) : null;
        if (parsed && typeof parsed === 'object') storageError = { ...parsed, status };
      } catch {
        // La respuesta no siempre es JSON; se conserva el body textual.
      }
      uploadErrorLog('error supabase storage upload', storageError);
      throw buildPhotoSyncError('FOTO-STORAGE-HTTP', 'El almacenamiento rechazó la foto', storageError);
    }

    await reportStage('FOTO-STORAGE-HTTP');
    return path;
  } catch (error) {
    uploadErrorLog('error inesperado al subir imagen', error);
    throw error;
  } finally {
    // Limpieza de archivos temporales creados durante el upload.
    if (sourceUri && /^file:\/\/.*upload-temp_/i.test(sourceUri) && !isFotoEnUploadNativo(sourceUri)) {
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
