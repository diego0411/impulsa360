import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { withTimeout } from './asyncTimeout';

export const LADO_REDUCCION_GALERIA = 1024;
const TIEMPO_MAXIMO_REDUCCION_MS = 30000;
const TIEMPO_MAXIMO_CANCELACION_MS = 5000;
const LADO_MAXIMO_PERMITIDO = 4096;
const moduloNativo = Platform.OS === 'android'
  ? NativeModules?.ImpulsaImageDownsampler
  : null;

let reduccionEnCurso = false;
let secuenciaOperacion = 0;

const crearErrorReduccion = (code, message, cause, photoReason) => {
  const error = new Error(message);
  error.code = code;
  error.photoReason = photoReason;
  if (cause) error.cause = cause;
  return error;
};

const crearIdOperacion = () => (
  `downsample-${Date.now().toString(36)}-${(secuenciaOperacion += 1).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
);

const eliminarTemporal = async (uri) => {
  if (!/^file:\/\//i.test(uri || '')) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
};

const clasificarErrorNativo = (error) => {
  const code = error?.code || 'E_DOWNSAMPLE_PROCESS';
  switch (code) {
    case 'E_DOWNSAMPLE_READ':
    case 'E_DOWNSAMPLE_FORMAT':
      return crearErrorReduccion(
        'E_DOWNSAMPLE_READ',
        'No se pudo leer o decodificar la imagen. El archivo puede estar dañado o tener un formato no compatible.',
        error,
        'downsample_read'
      );
    case 'E_DOWNSAMPLE_TIMEOUT':
      return crearErrorReduccion(
        'E_DOWNSAMPLE_TIMEOUT',
        'La reducción de la imagen tardó demasiado. Inténtalo de nuevo.',
        error,
        'downsample_timeout'
      );
    case 'E_DOWNSAMPLE_BUSY':
      return crearErrorReduccion(
        'E_DOWNSAMPLE_BUSY',
        'Ya hay una reducción de imagen en curso. Espera a que termine.',
        error,
        'downsample_busy'
      );
    case 'E_DOWNSAMPLE_CANCELLED':
      return crearErrorReduccion(
        'E_DOWNSAMPLE_CANCELLED',
        'La reducción de la imagen fue cancelada.',
        error,
        'downsample_cancelled'
      );
    case 'E_DOWNSAMPLE_ARGUMENT':
      return crearErrorReduccion(
        'E_DOWNSAMPLE_ARGUMENT',
        'La ruta o los parámetros de la imagen no son válidos.',
        error,
        'downsample_argument'
      );
    case 'E_DOWNSAMPLE_UNSUPPORTED':
      return crearErrorReduccion(
        'E_DOWNSAMPLE_UNSUPPORTED',
        'La reducción de imágenes grandes no está disponible en este dispositivo.',
        error,
        'downsample_unsupported'
      );
    case 'E_DOWNSAMPLE_PROCESS':
    case 'E_DOWNSAMPLE_SAVE':
    default:
      return crearErrorReduccion(
        code,
        'No se pudo procesar la imagen en el dispositivo. Inténtalo de nuevo.',
        error,
        'downsample_process'
      );
  }
};

const cancelarNativa = async (operationId) => {
  if (typeof moduloNativo?.cancel !== 'function') {
    return { canceled: false, supported: false };
  }
  try {
    const resultado = await withTimeout(
      Promise.resolve(moduloNativo.cancel(operationId)),
      TIEMPO_MAXIMO_CANCELACION_MS,
      'La cancelación de la reducción tardó demasiado.'
    );
    return {
      canceled: resultado === true || resultado?.canceled === true,
      supported: true,
    };
  } catch (error) {
    return { canceled: false, supported: true, error };
  }
};

const esperarReduccion = (promesaNativa, operationId, timeoutMs) => new Promise((resolve, reject) => {
  let terminado = false;
  let temporizador = null;

  const finalizar = (callback, value) => {
    if (terminado) return false;
    terminado = true;
    if (temporizador) {
      globalThis.clearTimeout(temporizador);
      temporizador = null;
    }
    callback(value);
    return true;
  };

  temporizador = globalThis.setTimeout(async () => {
    if (terminado) return;
    terminado = true;
    if (temporizador) {
      globalThis.clearTimeout(temporizador);
      temporizador = null;
    }
    const cancelacion = await cancelarNativa(operationId);
    const error = crearErrorReduccion(
      'E_DOWNSAMPLE_TIMEOUT',
      cancelacion.canceled
        ? 'La reducción de la imagen tardó demasiado y se canceló. Inténtalo de nuevo.'
        : 'La reducción de la imagen tardó demasiado. Espera un momento antes de reintentar.',
      cancelacion.error,
      'downsample_timeout'
    );
    error.cancelConfirmed = cancelacion.canceled === true;
    reject(error);
  }, timeoutMs);

  promesaNativa.then(
    (resultado) => {
      if (terminado) {
        eliminarTemporal(resultado?.uri);
        return;
      }
      finalizar(resolve, resultado);
    },
    (error) => {
      if (terminado) return;
      finalizar(reject, error);
    }
  );
});

export const puedeReducirImagenGaleria = () => (
  Boolean(
    moduloNativo
    && typeof moduloNativo.downsample === 'function'
    && typeof moduloNativo.cancel === 'function'
  )
);

export const reducirImagenGaleria = async (
  uri,
  {
    maxSide = LADO_REDUCCION_GALERIA,
    quality = 0.5,
    timeoutMs = TIEMPO_MAXIMO_REDUCCION_MS,
  } = {}
) => {
  if (!puedeReducirImagenGaleria()) {
    throw crearErrorReduccion(
      'E_DOWNSAMPLE_UNSUPPORTED',
      'La reducción de imágenes grandes no está disponible en este dispositivo.',
      null,
      'downsample_unsupported'
    );
  }
  if (reduccionEnCurso) {
    throw crearErrorReduccion(
      'E_DOWNSAMPLE_BUSY',
      'Ya hay una reducción de imagen en curso. Espera a que termine.',
      null,
      'downsample_busy'
    );
  }
  if (!/^(file|content):\/\//i.test(uri || '')) {
    throw crearErrorReduccion(
      'E_DOWNSAMPLE_ARGUMENT',
      'La ruta de la imagen no es válida.',
      null,
      'downsample_argument'
    );
  }
  if (
    !Number.isInteger(maxSide)
    || maxSide < 1
    || maxSide > LADO_MAXIMO_PERMITIDO
    || !Number.isFinite(quality)
    || quality < 0
    || quality > 1
    || !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
  ) {
    throw crearErrorReduccion(
      'E_DOWNSAMPLE_ARGUMENT',
      'Los parámetros de reducción no son válidos.',
      null,
      'downsample_argument'
    );
  }

  const operationId = crearIdOperacion();
  reduccionEnCurso = true;
  let promesaNativa;
  try {
    try {
      promesaNativa = Promise.resolve(
        moduloNativo.downsample(uri, maxSide, quality, operationId)
      );
    } catch (error) {
      throw clasificarErrorNativo(error);
    }

    const resultado = await esperarReduccion(promesaNativa, operationId, timeoutMs);
    const width = Number(resultado?.width);
    const height = Number(resultado?.height);
    if (
      !resultado?.uri
      || !Number.isSafeInteger(width)
      || !Number.isSafeInteger(height)
      || width <= 0
      || height <= 0
      || width > maxSide
      || height > maxSide
    ) {
      await eliminarTemporal(resultado?.uri);
      throw crearErrorReduccion(
        'E_DOWNSAMPLE_INVALID_RESULT',
        'La imagen reducida no tiene dimensiones válidas. Inténtalo de nuevo.',
        null,
        'downsample_process'
      );
    }
    return { uri: String(resultado.uri), width, height };
  } catch (error) {
    if (error?.photoReason) throw error;
    throw clasificarErrorNativo(error);
  } finally {
    reduccionEnCurso = false;
  }
};
