import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { isTimeoutError, withTimeout } from './asyncTimeout';

const PHOTO_ERROR_KEY = 'ultimo_error_foto_v1';
const DIAGNOSTIC_WRITE_TIMEOUT_MS = 2000;

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
