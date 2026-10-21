import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { isTimeoutError, withTimeout } from './asyncTimeout';

const PHOTO_ERROR_KEY = 'ultimo_error_foto_v1';
const PHOTO_CAMERA_EVENT_KEY = 'ultimo_hito_camara_v1';
const PHOTO_PROCESS_EVENT_KEY = 'ultimo_hito_procesamiento_foto_v1';
const DIAGNOSTIC_WRITE_TIMEOUT_MS = 2000;
const PHOTO_PROCESS_WRITE_TIMEOUT_MS = 350;
const STATUS_IN_PROGRESS = 'in_progress';
const STATUS_COMPLETED = 'completed';
const STATUS_ERROR = 'error';
let colaProcesamientoFoto = Promise.resolve();
let colaCamara = Promise.resolve();

const sanitizeMessage = (error) => {
  const raw = error?.message || String(error || 'Error desconocido');
  return raw
    .replace(/(?:file|content|https?):\/\/\S+/gi, '[ruta]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
};

export const crearCodigoErrorFoto = (stage, error) => (
  `FOTO-${String(stage || 'unknown').replace(/_/g, '-').toUpperCase()}-${isTimeoutError(error) ? 'TIMEOUT' : 'ERROR'}`
);

export const registrarErrorFoto = async (stage, error) => {
  const code = crearCodigoErrorFoto(stage, error);
  const diagnostic = {
    stage,
    message: sanitizeMessage(error),
    timestamp: new Date().toISOString(),
    platform: Platform.OS,
    platformVersion: String(Platform.Version ?? ''),
    code,
  };

  await withTimeout(
    AsyncStorage.setItem(PHOTO_ERROR_KEY, JSON.stringify(diagnostic)),
    DIAGNOSTIC_WRITE_TIMEOUT_MS,
    'No se pudo registrar el diagnóstico de foto.'
  ).catch(() => {});
  return code;
};

const enqueueCamara = (work) => {
  colaCamara = colaCamara.catch(() => {}).then(work);
  return colaCamara.catch(() => null);
};

const leerHitoCamaraActual = async () => {
  const raw = await withTimeout(
    AsyncStorage.getItem(PHOTO_CAMERA_EVENT_KEY),
    PHOTO_PROCESS_WRITE_TIMEOUT_MS,
    'No se pudo leer el hito de cámara.'
  ).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const crearIdCamara = () => (
  `cam_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
);

export const registrarHitoCamara = (cameraId, stage, campos = {}) => {
  if (!cameraId) return Promise.resolve(null);
  const diagnostic = {
    cameraId: String(cameraId).slice(0, 48),
    status: STATUS_IN_PROGRESS,
    stage: String(stage || 'unknown').slice(0, 32),
    timestamp: new Date().toISOString(),
    platform: Platform.OS,
    platformVersion: String(Platform.Version ?? ''),
    dimensionBucket: typeof campos.dimensionBucket === 'string'
      ? campos.dimensionBucket.slice(0, 12)
      : undefined,
  };
  Object.keys(diagnostic).forEach((key) => {
    if (diagnostic[key] === undefined) delete diagnostic[key];
  });

  return enqueueCamara(async () => {
    await withTimeout(
      AsyncStorage.setItem(PHOTO_CAMERA_EVENT_KEY, JSON.stringify(diagnostic)),
      PHOTO_PROCESS_WRITE_TIMEOUT_MS,
      'No se pudo registrar el hito de cámara.'
    ).catch(() => {});
    return diagnostic;
  });
};

export const finalizarHitoCamara = (cameraId, stage = 'CLOSED') => {
  if (!cameraId) return Promise.resolve(null);
  return enqueueCamara(async () => {
    const actual = await leerHitoCamaraActual();
    if (!actual || actual.cameraId !== cameraId) return null;
    const finalizado = {
      ...actual,
      status: STATUS_COMPLETED,
      stage: String(stage || 'CLOSED').slice(0, 32),
      completedAt: new Date().toISOString(),
    };
    await withTimeout(
      AsyncStorage.setItem(PHOTO_CAMERA_EVENT_KEY, JSON.stringify(finalizado)),
      PHOTO_PROCESS_WRITE_TIMEOUT_MS,
      'No se pudo finalizar el hito de cámara.'
    ).catch(() => {});
    return finalizado;
  });
};

export const consumirUltimoHitoCamara = async () => {
  const hito = await enqueueCamara(async () => {
    const actual = await leerHitoCamaraActual();
    await withTimeout(
      AsyncStorage.removeItem(PHOTO_CAMERA_EVENT_KEY),
      PHOTO_PROCESS_WRITE_TIMEOUT_MS,
      'No se pudo limpiar el hito de cámara.'
    ).catch(() => {});
    return actual;
  });
  return hito?.status === STATUS_IN_PROGRESS ? hito : null;
};

const enqueueProcesamientoFoto = (work) => {
  colaProcesamientoFoto = colaProcesamientoFoto.catch(() => {}).then(work);
  return colaProcesamientoFoto.catch(() => null);
};

const leerHitoProcesamientoActual = async () => {
  const raw = await withTimeout(
    AsyncStorage.getItem(PHOTO_PROCESS_EVENT_KEY),
    PHOTO_PROCESS_WRITE_TIMEOUT_MS,
    'No se pudo leer el hito de procesamiento de foto.'
  ).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const crearIdProcesamientoFoto = () => (
  `foto_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
);

export const registrarHitoProcesamientoFoto = (processId, stage, campos = {}) => {
  if (!processId) return Promise.resolve(null);
  const diagnostic = {
    processId: String(processId).slice(0, 48),
    status: STATUS_IN_PROGRESS,
    stage: String(stage || 'unknown').slice(0, 32),
    timestamp: new Date().toISOString(),
    platform: Platform.OS,
    platformVersion: String(Platform.Version ?? ''),
    width: Number.isFinite(Number(campos.width)) ? Number(campos.width) : undefined,
    height: Number.isFinite(Number(campos.height)) ? Number(campos.height) : undefined,
    photoSizeBucket: typeof campos.photoSizeBucket === 'string' ? campos.photoSizeBucket.slice(0, 8) : undefined,
  };
  Object.keys(diagnostic).forEach((key) => {
    if (diagnostic[key] === undefined) delete diagnostic[key];
  });

  return enqueueProcesamientoFoto(async () => {
    const actual = await leerHitoProcesamientoActual();
    if (
      actual?.status === STATUS_IN_PROGRESS
      && actual.processId
      && actual.processId !== diagnostic.processId
    ) return null;
    await withTimeout(
      AsyncStorage.setItem(PHOTO_PROCESS_EVENT_KEY, JSON.stringify(diagnostic)),
      PHOTO_PROCESS_WRITE_TIMEOUT_MS,
      'No se pudo registrar el hito de procesamiento de foto.'
    ).catch(() => {});
    return diagnostic;
  });
};

export const consumirUltimoHitoProcesamientoFoto = async () => {
  const hito = await enqueueProcesamientoFoto(async () => {
    const actual = await leerHitoProcesamientoActual();
    await withTimeout(
      AsyncStorage.removeItem(PHOTO_PROCESS_EVENT_KEY),
      PHOTO_PROCESS_WRITE_TIMEOUT_MS,
      'No se pudo limpiar el hito de procesamiento de foto.'
    ).catch(() => {});
    return actual;
  });
  return hito?.status === STATUS_IN_PROGRESS ? hito : null;
};

export const finalizarHitoProcesamientoFoto = (processId, status = STATUS_COMPLETED) => {
  if (!processId) return Promise.resolve(null);
  const estadoFinal = status === STATUS_ERROR ? STATUS_ERROR : STATUS_COMPLETED;
  return enqueueProcesamientoFoto(async () => {
    const actual = await leerHitoProcesamientoActual();
    if (!actual || actual.processId !== processId) return null;
    const finalizado = {
      ...actual,
      status: estadoFinal,
      completedAt: new Date().toISOString(),
    };
    await withTimeout(
      AsyncStorage.setItem(PHOTO_PROCESS_EVENT_KEY, JSON.stringify(finalizado)),
      PHOTO_PROCESS_WRITE_TIMEOUT_MS,
      'No se pudo finalizar el hito de procesamiento de foto.'
    ).catch(() => {});
    return finalizado;
  });
};
