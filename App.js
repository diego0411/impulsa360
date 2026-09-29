// App.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  Alert,
  StyleSheet,
  AppState,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { v4 as uuidv4 } from 'uuid';

import { clearLocalSupabaseSession, supabase } from './lib/supabase';
import { HAS_SUPABASE_CONFIG, SUPABASE_CONFIG_ERROR } from './lib/config';
import { secureLocalStorage } from './lib/secureLocalStorage';
import { colors, spacing, fontSizes } from './styles/theme';
import { normalizarNombreVisible } from './lib/identity';
import { enmascararMarcaVisible } from './lib/brandMask';
import { tienePlazaValida } from './lib/plazas';
import { obtenerPlazasTemporales } from './lib/plazasTemporales';
import { withTimeout } from './lib/asyncTimeout';
import { requiereValidacionReactivacion, validarElegibilidadReactivacion } from './lib/elegibilidadReactivacion';
import AuthScreen from './components/AuthScreen';
import LaunchIntroScreen from './components/LaunchIntroScreen';
import FormularioActivacion from './components/FormularioActivacion';
import FormulariosPorImpulsador from './components/FormulariosPorImpulsador';
import NotificacionesScreen from './components/NotificacionesScreen';
import ControlActivadores from './components/ControlActivadores';
import {
  obtenerFormulariosLocales,
  eliminarFormularioLocal,
  actualizarFormularioLocal,
  marcarErrorSync,
} from './lib/storage';
import {
  ACTIVACIONES_BUCKET,
  asegurarFotoPendientePersistente,
  limpiarFotosPendientesHuerfanas,
  subirImagenASupabase,
} from './lib/upload';
import {
  clearOfflinePin,
  hasOfflinePin,
  saveOfflinePin,
  getOfflinePinStatus,
  pinPolicy,
} from './lib/offlinePin';
import { obtenerConteoNoLeidas } from './lib/notificaciones';

const MIN_BRANDED_INTRO_MS = 3200;
const SESSION_TIMEOUT_MS = 8000;
const QUERY_TIMEOUT_MS = 10000;
const SYNC_UPSERT_TIMEOUT_MS = 12000;
const PHOTO_UPLOAD_TIMEOUT_MS = 45000;
const SYNC_MAX_RETRIES = 3;
const SYNC_RETRY_BACKOFF_MS = [2000, 5000, 10000];
const APP_VERSION_CODE = String(
  Constants.nativeBuildVersion || Constants.expoConfig?.android?.versionCode || 'desconocida'
);
const perfilTieneAcceso = (perfil) => (
  !!perfil?.usuario_id
  && String(perfil?.estado || '').trim().toLowerCase() === 'activo'
);
const esPerfilAusente = (error) => error?.code === 'PGRST116';
const esErrorAuthDefinitivo = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('refresh token')
    && (message.includes('invalid') || message.includes('not found') || message.includes('expired'));
};
const syncDebug = (...args) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[sync]', ...args);
};
const syncWarn = (...args) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[sync]', ...args);
};
const syncError = (...args) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.error('[sync]', ...args);
};
const syncErrorInfo = (error) => ({
  message: error?.message || String(error || 'Error desconocido'),
  code: error?.code ?? null,
  details: error?.details ?? null,
  hint: error?.hint ?? null,
  status: error?.status ?? error?.statusCode ?? null,
});
const syncErrorMessage = (error) => {
  const info = syncErrorInfo(error);
  return [
    info.message,
    info.code ? `code=${info.code}` : '',
    info.status ? `status=${info.status}` : '',
    info.details ? `details=${info.details}` : '',
    info.hint ? `hint=${info.hint}` : '',
  ].filter(Boolean).join(' | ');
};
const syncErrorStatus = (error) => {
  const raw = error?.status ?? error?.statusCode;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};
const esErrorTransitorioSync = (error) => {
  const status = syncErrorStatus(error);
  if ([400, 401, 403].includes(status)) return false;
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;

  const name = String(error?.name || error?.causeName || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (name === 'timeouterror' || name === 'authretryablefetcherror' || name === 'storageunknownerror') return true;
  if (/^(econn|enet|etimedout|ehost|dns)/.test(code)) return true;
  return /network request failed|failed to fetch|fetch failed|network error|timeout|timed out|connection reset|connection aborted|socket hang up|internet.*unreachable/.test(message);
};
const esperarSyncRetry = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));
const hayConexionParaRetry = async () => {
  try {
    const state = await NetInfo.fetch();
    return !!state?.isConnected && state?.isInternetReachable !== false;
  } catch {
    return false;
  }
};
const ejecutarConRetrySync = async (operation, { onFailure } = {}) => {
  let retry = 0;
  while (true) {
    try {
      return await operation(retry + 1);
    } catch (error) {
      const transitorio = esErrorTransitorioSync(error);
      const puedeReintentar = transitorio && retry < SYNC_MAX_RETRIES;
      if (typeof onFailure === 'function') {
        await onFailure(error, { attempt: retry + 1, willRetry: puedeReintentar });
      }
      if (!puedeReintentar) throw error;
      if (!(await hayConexionParaRetry())) throw error;
      await esperarSyncRetry(SYNC_RETRY_BACKOFF_MS[retry]);
      retry += 1;
    }
  }
};
const isLocalPhotoUri = (value) => typeof value === 'string' && /^(file|content):\/\//i.test(value);
const esActivacionTranseunte = (tipoActivacion) =>
  String(tipoActivacion || '').toLowerCase() === 'transeunte';
const isRemotePhotoRef = (value) => (
  typeof value === 'string'
  && value.trim()
  && !isLocalPhotoUri(value)
);
const normalizeOptionalDbValue = (value) => {
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
};
const sanitizeActivationPayload = (payload = {}) => {
  const clean = { ...payload };
  const tipo = clean.tipo_activacion;
  const base = clean.base_activacion;
  const isTiendaBarrio = base === 'tienda_barrio';
  const isComercio = base === 'comercio';

  if (!isTiendaBarrio) {
    clean.tipo_tienda = null;
    clean.tamano_tienda = null;
  }
  if (!isComercio) {
    clean.tipo_comercio = null;
    clean.rubro_comercio = null;
    clean.rubro_comercio_otro = null;
    clean.comercio_fuera_mercado = null;
  }
  if (tipo !== 'reactivacion_comercio' && tipo !== 'reactivacion_transeunte' && tipo !== 'reactivacion') {
    clean.reactivacion_comercio = false;
  }

  return clean;
};
const buildPhotoStoragePath = (usuarioId, recordId, key) => {
  const fileName = key === 'foto_cash_in' ? 'cash-in.jpg' : 'principal.jpg';
  return `activaciones/${usuarioId}/${recordId}/${fileName}`;
};
const existeFotoRemota = async (path) => {
  if (!path) return false;
  const partes = String(path).split('/').filter(Boolean);
  const nombre = partes.pop();
  const carpeta = partes.join('/');
  if (!nombre || !carpeta) return false;
  const { data, error } = await withTimeout(
    supabase.storage.from(ACTIVACIONES_BUCKET).list(carpeta, { limit: 100 }),
    QUERY_TIMEOUT_MS,
    'La red está tardando demasiado al verificar la foto remota.'
  );
  if (error || !Array.isArray(data)) {
    syncWarn('foto remota no encontrada', { path, error: error ? syncErrorInfo(error) : null });
    return false;
  }
  return data.some((item) => item?.name === nombre);
};
const listFolderPhotoCandidates = async (folder) => {
  if (!folder) return [];
  const { data, error } = await withTimeout(
    supabase.storage.from(ACTIVACIONES_BUCKET).list(folder, { limit: 20 }),
    QUERY_TIMEOUT_MS,
    'La red está tardando demasiado al listar fotos remotas.'
  );
  if (error || !Array.isArray(data)) {
    syncWarn('no se pudo listar carpeta de fotos', { folder, error: error ? syncErrorInfo(error) : null });
    return [];
  }
  return data
    .filter((item) => item?.name && !item.name.endsWith('/'))
    .map((item) => `${folder}/${item.name}`);
};
const uniqueStrings = (values) => Array.from(new Set(values.filter(Boolean)));
const findHistoricalRemotePhoto = async ({ usuario, formulario, localId, recordId, key }) => {
  const currentRef = formulario[key];
  if (isRemotePhotoRef(currentRef)) return currentRef;

  const usuarioIds = uniqueStrings([usuario?.id, usuario?.usuario_id, formulario?.usuario_id]);
  const recordIds = uniqueStrings([recordId, formulario?.id, localId, formulario?._id_local]);
  const fileNames = key === 'foto_cash_in'
    ? ['cash-in.jpg', 'cash_in.jpg', 'foto_cash_in.jpg']
    : ['principal.jpg', 'foto.jpg', 'foto_url.jpg'];
  const directCandidates = [];
  for (const userId of usuarioIds) {
    for (const id of recordIds) {
      for (const fileName of fileNames) {
        directCandidates.push(`activaciones/${userId}/${id}/${fileName}`);
      }
    }
  }
  if (key === 'foto_url') {
    for (const id of recordIds) {
      directCandidates.push(`activaciones/${id}.jpg`);
      directCandidates.push(`activaciones/${id}_respaldo.jpg`);
    }
  }

  const listCandidates = [];
  for (const userId of usuarioIds) {
    for (const id of recordIds) {
      listCandidates.push(...await listFolderPhotoCandidates(`activaciones/${userId}/${id}`));
    }
  }

  const candidates = uniqueStrings([...directCandidates, ...listCandidates]);
  const preferred = candidates.sort((a, b) => {
    const nameA = a.toLowerCase();
    const nameB = b.toLowerCase();
    const score = (name) => {
      if (key === 'foto_cash_in' && /cash[-_]?in|foto_cash_in/.test(name)) return 0;
      if (key === 'foto_url' && /principal|foto_url|\/[^/]+\.jpg$/.test(name)) return 0;
      return 1;
    };
    return score(nameA) - score(nameB);
  });

  for (const candidate of preferred) {
    if (await existeFotoRemota(candidate)) return candidate;
  }
  return '';
};
SplashScreen.preventAutoHideAsync().catch(() => {});

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('❌ Error en el arranque de la app:', error?.message || error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>No se pudo iniciar la app</Text>
          <Text style={styles.errorText}>La aplicación encontró un problema inesperado. Vuelve a abrirla e intenta nuevamente.</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

function AppShell() {
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(true);
  const [introDone, setIntroDone] = useState(false);
  const [cantidadOffline, setCantidadOffline] = useState(0);
  const [isConnected, setIsConnected] = useState(null);
  const [vistaActiva, setVistaActiva] = useState('formulario');
  const [notificacionesNoLeidas, setNotificacionesNoLeidas] = useState(0);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinConfigurado, setPinConfigurado] = useState(false);
  const [pinNuevo, setPinNuevo] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinGuardando, setPinGuardando] = useState(false);
  const [sesionOnlineValida, setSesionOnlineValida] = useState(false);
  const syncingRef = useRef(false);
  const lastSyncRef = useRef(0);
  const splashHiddenRef = useRef(false);
  const validacionSesionRef = useRef(null);
  const revalidarSesionRef = useRef(false);
  const logoutEnCursoRef = useRef(false);
  const restauracionInicialCompletaRef = useRef(false);
  const usuarioRef = useRef(usuario);
  const sesionOnlineValidaRef = useRef(sesionOnlineValida);
  usuarioRef.current = usuario;
  sesionOnlineValidaRef.current = sesionOnlineValida;

  const contarFormulariosLocales = useCallback(async () => {
    const datos = await obtenerFormulariosLocales();
    setCantidadOffline(usuario?.id ? datos.filter((item) => item?.usuario_id === usuario.id).length : 0);
  }, [usuario?.id]);

  const sincronizarFormularios = useCallback(async ({ showAlerts = true, force = false, targetLocalId = null } = {}) => {
    if (syncingRef.current) {
      if (force) {
        for (let attempt = 0; attempt < 20 && syncingRef.current; attempt += 1) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 300));
        }
      }
      if (syncingRef.current) return { status: 'busy', synced: 0, errors: [] };
    }
    if (!usuario?.id) {
      if (showAlerts) {
        Alert.alert('Sesión requerida', 'Vuelve a iniciar sesión antes de sincronizar.');
      }
      return { status: 'error', synced: 0, errors: ['Sesión requerida'] };
    }
    if (!isConnected) {
      if (showAlerts) {
        Alert.alert('Sin conexión', 'Conéctate a internet para sincronizar.');
      }
      return { status: 'offline', synced: 0, errors: [] };
    }
    if (!sesionOnlineValida) {
      if (showAlerts) {
        Alert.alert('Sesión pendiente', 'Espera mientras se valida tu acceso antes de sincronizar.');
      }
      return { status: 'unauthorized', synced: 0, errors: ['Sesión online no validada'] };
    }

    const now = Date.now();
    if (!showAlerts && !force && now - lastSyncRef.current < 10000) return { status: 'busy', synced: 0, errors: [] };
    lastSyncRef.current = now;

    syncingRef.current = true;
    syncDebug('inicio', { force, showAlerts });
    try {
      const todosFormularios = await obtenerFormulariosLocales();
      const pendientesLegacy = todosFormularios.filter((f) => !f?.usuario_id);
      const pendientesOtroUsuario = todosFormularios.filter(
        (f) => f?.usuario_id && f.usuario_id !== usuario.id,
      );
      const pendientesPropios = todosFormularios.filter((f) => f?.usuario_id === usuario.id);
      const objetivo = targetLocalId
        ? todosFormularios.find((f) => f?._id_local === targetLocalId || f?.id === targetLocalId)
        : null;

      if (objetivo && !objetivo.usuario_id) {
        const mensaje = 'El pendiente no tiene usuario propietario y se conservará sin sincronizar.';
        if (showAlerts) Alert.alert('Pendiente legacy bloqueado', mensaje);
        return { status: 'blocked', synced: 0, errors: [mensaje], legacyWithoutOwner: 1 };
      }
      if (objetivo && objetivo.usuario_id !== usuario.id) {
        const mensaje = 'El pendiente pertenece a otro usuario y no puede sincronizarse desde esta sesión.';
        if (showAlerts) Alert.alert('Pendiente no autorizado', mensaje);
        return { status: 'forbidden', synced: 0, errors: [mensaje] };
      }

      const formularios = targetLocalId
        ? pendientesPropios.filter((f) => f?._id_local === targetLocalId || f?.id === targetLocalId)
        : pendientesPropios;
      syncDebug('formularios pendientes', {
        propios: formularios.length,
        otrosUsuarios: pendientesOtroUsuario.length,
        legacySinOwner: pendientesLegacy.length,
      });
      if (!formularios.length) {
        if (targetLocalId) {
          return {
            status: 'synced',
            synced: 1,
            errors: [],
            syncedLocalIds: [targetLocalId],
            syncedRecordIds: [],
          };
        }
        if (showAlerts) {
          const legacyInfo = pendientesLegacy.length
            ? ` Hay ${pendientesLegacy.length} pendiente(s) legacy sin propietario, preservados y bloqueados.`
            : '';
          Alert.alert('Sin formularios', `No hay formularios pendientes para este usuario.${legacyInfo}`);
        }
        return {
          status: 'empty',
          synced: 0,
          errors: [],
          legacyWithoutOwner: pendientesLegacy.length,
          skippedOtherOwners: pendientesOtroUsuario.length,
        };
      }

      let ok = 0;
      const errores = [];
      const syncedLocalIds = [];
      const syncedRecordIds = [];
      const allowedFields = [
        'id',
        'nombres_cliente',
        'apellidos_cliente',
        'ci_cliente',
        'telefono_cliente',
        'email_cliente',
        'descargo_app',
        'registro',
        'cash_in',
        'cash_out',
        'p2p',
        'qr_fisico',
        'hubo_error',
        'descripcion_error',
        'tipo_error',
        'foto_cash_in',
        'tipo_tienda',
        'rubro_comercio',
        'rubro_comercio_otro',
        'comercio_fuera_mercado',
        'es_plaza_temporal',
        'plaza_temporal',
        'tipo_activacion',
        'base_activacion',
        'es_reactivacion',
        'tamano_tienda',
        'tipo_comercio',
        'foto_url',
        'fecha_activacion',
        'latitud',
        'longitud',
        'reactivacion_comercio',
        'respaldo',
        'ciudad_activacion',
        'zona_activacion',
        'distrito_gps',
        'region_gps',
        'plaza',
        'estado_sync',
        'dispositivo',
      ];

      for (const f of formularios) {
        // En tu storage nuevo puede existir _id_local; mantenemos compatibilidad
        const localId = f._id_local ?? f.id;

        // Clonamos para no mutar el original
        const { _id_local, _created_at, _updated_at, _sync, ...formulario } = f;
        const ownerId = formulario.usuario_id;
        if (!ownerId || ownerId !== usuario.id) {
          // Defensa adicional: nunca mutar un pendiente cuyo owner no coincida.
          continue;
        }

        // Asegura id UUID estable
        const recordId = (formulario.id && typeof formulario.id === 'string' && formulario.id.length > 20)
          ? formulario.id
          : uuidv4();
        if (!formulario.id || formulario.id !== recordId) {
          formulario.id = recordId;
          await actualizarFormularioLocal(localId, { id: recordId });
        }
        syncDebug('registro local', { localId, recordId });

        // Asegura fecha
        formulario.fecha_activacion ??= new Date().toISOString().split('T')[0];
        formulario.estado_sync ??= 'offline_pending';
        // Limpia campos que no existan en la tabla
        delete formulario.fecha_hora;

        if (requiereValidacionReactivacion(formulario.tipo_activacion)) {
          try {
            const elegibilidad = await validarElegibilidadReactivacion({
              ci: formulario.ci_cliente,
              telefono: formulario.telefono_cliente,
              tipoActivacion: formulario.tipo_activacion,
              registroId: recordId,
              fechaReferencia: formulario.fecha_activacion,
            });
            if (!elegibilidad.ok) {
              await marcarErrorSync(localId, elegibilidad.mensaje);
              errores.push(`ID local ${localId}: ${elegibilidad.mensaje}`);
              continue;
            }
          } catch (e) {
            const errorMsg = `No se pudo validar elegibilidad de reactivación: ${syncErrorMessage(e)}`;
            syncError('fallo validacion reactivacion', { localId, recordId, error: syncErrorInfo(e) });
            await marcarErrorSync(localId, errorMsg);
            errores.push(`ID local ${localId}: ${errorMsg}`);
            continue;
          }
        }

        const localPhotosForCleanup = { ...(_sync?.localPhotos || {}) };
        let syncMetadata = { ...(_sync || {}), localPhotos: localPhotosForCleanup };
        const actualizarEtapaFoto = async (stage, result = 'running', extra = {}) => {
          const attemptAt = extra.lastAttemptAt || new Date().toISOString();
          syncMetadata = {
            ...syncMetadata,
            ...extra,
            lastAttemptAt: attemptAt,
            lastAttemptVersionCode: APP_VERSION_CODE,
            lastAttemptStage: stage,
            lastAttemptResult: result,
          };
          await actualizarFormularioLocal(localId, { _sync: syncMetadata });
        };
        const effectiveFotoUrl = formulario.foto_url || localPhotosForCleanup.foto_url;
        const effectiveFotoCashIn = formulario.foto_cash_in || localPhotosForCleanup.foto_cash_in;
        const esTranseunte = esActivacionTranseunte(formulario.tipo_activacion);
        const requiereFotoPrincipal = !esTranseunte;
        const requiereCashIn = !requiereValidacionReactivacion(formulario.tipo_activacion) && !esActivacionTranseunte(formulario.tipo_activacion);

        if ((requiereFotoPrincipal && !effectiveFotoUrl) || (requiereCashIn && !effectiveFotoCashIn)) {
          syncWarn('fotos obligatorias faltantes', { localId, recordId });
          const errorMsg = esTranseunte
            ? 'Falta la foto Cash-In obligatoria.'
            : requiereCashIn ? 'Faltan las dos fotos obligatorias.' : 'Falta la foto de activación.';
          await marcarErrorSync(localId, errorMsg);
          errores.push(`ID local ${localId}: ${errorMsg}`);
          continue;
        }

        // Sube imágenes pendientes. foto_url se incluye siempre que exista
        // (cubre evidencia voluntaria de transeúnte); el loop solo sube URIs
        // locales y omite remotas ya subidas. La obligatoriedad sigue en el
        // bloque de validación de arriba y no cambia.
        const fotoKeys = [...(effectiveFotoUrl ? ['foto_url'] : []), ...(effectiveFotoCashIn ? ['foto_cash_in'] : [])];
        let fotoUploadFailed = false;
        syncDebug('rehydratedUri', { localId, recordId, localPhotos: localPhotosForCleanup });
        for (const key of fotoKeys) {
          const fieldUri = formulario[key] || localPhotosForCleanup[key];
          const preferredLocalUri = localPhotosForCleanup[key];
          let uploadSourceUri = isLocalPhotoUri(preferredLocalUri) ? preferredLocalUri : fieldUri;
          const fieldAlreadyRemote = typeof fieldUri === 'string' && fieldUri && !isLocalPhotoUri(fieldUri);
          let shouldUploadLocal = isLocalPhotoUri(uploadSourceUri) && !fieldAlreadyRemote;

          if (shouldUploadLocal) {
            const photoAttemptAt = new Date().toISOString();
            await actualizarEtapaFoto('FOTO-LOCAL-READ', 'running', {
              error: null,
              lastAttemptAt: photoAttemptAt,
              lastAttemptCode: null,
              lastAttemptField: key,
            });
            let fileInfo = await FileSystem.getInfoAsync(uploadSourceUri, { size: true }).catch(() => null);
            syncDebug('existsBeforeUpload', {
              localId,
              recordId,
              key,
              fieldUri,
              rehydratedUri: preferredLocalUri,
              uploadSourceUri,
              exists: !!fileInfo?.exists,
              size: fileInfo?.size,
            });
            if (!fileInfo?.exists) {
              const remotePath = await findHistoricalRemotePhoto({ usuario, formulario, localId, recordId, key });
              syncWarn('foto local no encontrada', {
                localId,
                recordId,
                key,
                uploadSourceUri,
                remotePath,
                remoteRecovered: !!remotePath,
              });
              if (remotePath) {
                formulario[key] = remotePath;
                delete localPhotosForCleanup[key];
                await actualizarFormularioLocal(localId, {
                  [key]: remotePath,
                  _sync: {
                    ...(_sync || {}),
                    status: 'pending',
                    error: null,
                    localPhotos: localPhotosForCleanup,
                  },
                });
                continue;
              }
              const errorMsg = key === 'foto_cash_in'
                ? 'Foto Cash-In original no recuperable. Reemplázala para sincronizar.'
                : 'Foto de activación original no recuperable. Reemplázala para sincronizar.';
              await marcarErrorSync(localId, errorMsg, {
                ...syncMetadata,
                lastAttemptAt: photoAttemptAt,
                lastAttemptVersionCode: APP_VERSION_CODE,
                lastAttemptStage: 'FOTO-LOCAL-READ',
                lastAttemptCode: 'FOTO-LOCAL-READ',
                lastAttemptResult: 'error',
                lastAttemptField: key,
              });
              errores.push(`ID local ${localId}: ${errorMsg}`);
              fotoUploadFailed = true;
              continue;
            }
            const persistentUri = await asegurarFotoPendientePersistente(uploadSourceUri, key).catch((error) => {
              syncWarn('no se pudo migrar foto local a almacenamiento persistente', { localId, recordId, key, error: syncErrorInfo(error) });
              return null;
            });
            if (!persistentUri) {
              const errorMsg = key === 'foto_cash_in'
                ? 'Foto Cash-In no pudo guardarse en almacenamiento persistente. Reemplázala para sincronizar.'
                : 'Foto de activación no pudo guardarse en almacenamiento persistente. Reemplázala para sincronizar.';
              await marcarErrorSync(localId, errorMsg, {
                ...syncMetadata,
                lastAttemptAt: photoAttemptAt,
                lastAttemptVersionCode: APP_VERSION_CODE,
                lastAttemptStage: 'FOTO-LOCAL-READ',
                lastAttemptCode: 'FOTO-LOCAL-READ',
                lastAttemptResult: 'error',
                lastAttemptField: key,
              });
              errores.push(`ID local ${localId}: ${errorMsg}`);
              fotoUploadFailed = true;
              continue;
            }
            if (persistentUri !== uploadSourceUri) {
              uploadSourceUri = persistentUri;
              formulario[key] = persistentUri;
              localPhotosForCleanup[key] = persistentUri;
              fileInfo = await FileSystem.getInfoAsync(uploadSourceUri, { size: true }).catch(() => null);
              if (!fileInfo?.exists) {
                const errorMsg = key === 'foto_cash_in'
                  ? 'Foto Cash-In original no recuperable. Reemplázala para sincronizar.'
                  : 'Foto de activación original no recuperable. Reemplázala para sincronizar.';
                await marcarErrorSync(localId, errorMsg, {
                  ...syncMetadata,
                  lastAttemptAt: photoAttemptAt,
                  lastAttemptVersionCode: APP_VERSION_CODE,
                  lastAttemptStage: 'FOTO-LOCAL-READ',
                  lastAttemptCode: 'FOTO-LOCAL-READ',
                  lastAttemptResult: 'error',
                  lastAttemptField: key,
                });
                errores.push(`ID local ${localId}: ${errorMsg}`);
                fotoUploadFailed = true;
                continue;
              }
              await actualizarFormularioLocal(localId, {
                [key]: persistentUri,
                _sync: {
                  ...(_sync || {}),
                  status: 'pending',
                  error: null,
                  localPhotos: localPhotosForCleanup,
                },
              });
            }
            try {
              const path = buildPhotoStoragePath(ownerId, recordId, key);
              let intentoFotoAt = photoAttemptAt;
              const storagePath = await ejecutarConRetrySync(
                async (attempt) => {
                  intentoFotoAt = new Date().toISOString();
                  await actualizarEtapaFoto('FOTO-LOCAL-READ', 'running', {
                    error: null,
                    lastAttemptAt: intentoFotoAt,
                    lastAttemptCode: null,
                    lastAttemptField: key,
                    lastAttemptRetry: attempt,
                  });
                  syncDebug(key === 'foto_cash_in' ? 'cash-in upload' : 'foto activacion upload', {
                    localId,
                    recordId,
                    path,
                    attempt,
                  });
                  return withTimeout(
                    subirImagenASupabase(uploadSourceUri, path, {
                      onStage: (stage) => actualizarEtapaFoto(stage, 'running', {
                        lastAttemptAt: intentoFotoAt,
                        lastAttemptRetry: attempt,
                      }),
                    }),
                    PHOTO_UPLOAD_TIMEOUT_MS,
                    'La señal está muy débil para subir la foto. Se reintentará luego.'
                  );
                },
                {
                  onFailure: async (error, { attempt, willRetry }) => {
                    const errorCode = error?.photoSyncCode || 'FOTO-STORAGE-NETWORK';
                    const errorMsg = `No se pudo subir la foto (${key}): ${syncErrorMessage(error)}`;
                    syncMetadata = {
                      ...syncMetadata,
                      status: 'pending',
                      tries: Number(syncMetadata.tries || 0) + 1,
                      error: errorMsg,
                      lastAttemptAt: intentoFotoAt,
                      lastAttemptVersionCode: APP_VERSION_CODE,
                      lastAttemptStage: errorCode,
                      lastAttemptCode: errorCode,
                      lastAttemptResult: willRetry ? 'retrying' : 'error',
                      lastAttemptField: key,
                      lastAttemptRetry: attempt,
                    };
                    await actualizarFormularioLocal(localId, { _sync: syncMetadata });
                  },
                }
              );
              if (storagePath) {
                formulario[key] = storagePath;
                localPhotosForCleanup[key] = uploadSourceUri;
                syncMetadata = {
                  ...syncMetadata,
                  status: 'pending',
                  error: null,
                  localPhotos: localPhotosForCleanup,
                  lastAttemptAt: intentoFotoAt,
                  lastAttemptVersionCode: APP_VERSION_CODE,
                  lastAttemptStage: 'FOTO-STORAGE-HTTP',
                  lastAttemptCode: null,
                  lastAttemptResult: 'success',
                };
                await actualizarFormularioLocal(localId, {
                  [key]: storagePath,
                  _sync: syncMetadata,
                });
              } else {
                syncWarn('upload sin storagePath', { localId, recordId, key, path });
                const errorMsg = `No se pudo subir la foto (${key})`;
                await marcarErrorSync(localId, errorMsg);
                errores.push(`ID local ${localId}: ${errorMsg}`);
                fotoUploadFailed = true;
                continue;
              }
            } catch (e) {
              syncError('fallo upload foto', { localId, recordId, key, error: syncErrorInfo(e) });
              const errorMsg = `No se pudo subir la foto (${key}): ${syncErrorMessage(e)}`;
              errores.push(`ID local ${localId}: ${errorMsg}`);
              fotoUploadFailed = true;
              continue;
            }
          } else {
            syncDebug('foto remota existente', { localId, recordId, key, fieldUri, rehydratedUri: preferredLocalUri });
          }
        }
        if (fotoUploadFailed) {
          continue;
        }

        // Solo enviamos columnas permitidas para evitar errores de esquema
        let payload = allowedFields.reduce((acc, key) => {
          if (formulario[key] !== undefined) acc[key] = normalizeOptionalDbValue(formulario[key]);
          return acc;
        }, {});
        payload = sanitizeActivationPayload(payload);

        // El owner persistido es definitivo; la sesión actual solo autoriza
        // procesar pendientes cuyo usuario_id ya coincide.
        const nombreImpulsador = normalizarNombreVisible(usuario?.nombre || '');
        const plazaFallback = tienePlazaValida(usuario?.plaza) ? usuario.plaza : null;
        const datosConUsuario = {
          ...payload,
          id: recordId,
          usuario_id: ownerId,
          impulsador: payload.impulsador || nombreImpulsador || usuario?.email || '',
          plaza: payload.plaza || plazaFallback,
          estado_sync: 'online',
        };

        let upsertError = null;
        try {
          await ejecutarConRetrySync(
            async (attempt) => {
              const { error } = await withTimeout(
                supabase.from('activaciones').upsert(datosConUsuario, { onConflict: 'id' }),
                SYNC_UPSERT_TIMEOUT_MS,
                'La señal está muy débil para sincronizar. Se reintentará luego.'
              );
              syncDebug('upsert', { localId, recordId, ok: !error, attempt });
              if (error) throw error;
            },
            {
              onFailure: async (error) => {
                const errorMsg = `Upsert activacion: ${syncErrorMessage(error)}`;
                await marcarErrorSync(localId, errorMsg);
              },
            }
          );
        } catch (error) {
          upsertError = error;
        }

        if (!upsertError) {
          const cleanupUris = Object.values(localPhotosForCleanup)
            .filter((uri) => typeof uri === 'string' && /^file:\/\//i.test(uri));
          await Promise.all(cleanupUris.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})));
          syncDebug('cleanup final fotos locales', { localId, recordId, count: cleanupUris.length });
          await eliminarFormularioLocal(localId);
          ok += 1;
          syncedLocalIds.push(localId);
          syncedRecordIds.push(recordId);
        } else {
          syncError('fallo upsert activacion', { localId, recordId, error: syncErrorInfo(upsertError) });
          const errorMsg = `Upsert activacion: ${syncErrorMessage(upsertError)}`;
          errores.push(`ID local ${localId}: ${errorMsg}`);
        }
      }

      // Resumen
      if (showAlerts) {
        if (errores.length === 0) {
          Alert.alert('Sincronización completa', `Se sincronizaron ${ok} formulario(s).`);
        } else if (ok > 0) {
          Alert.alert('Parcialmente sincronizado', `OK: ${ok}\nErrores: ${errores.length}\n\n${errores.slice(0, 3).join('\n')}${errores.length > 3 ? '\n…' : ''}`);
        } else {
          Alert.alert('Sincronización fallida', errores.slice(0, 5).join('\n'));
        }
      }
      const result = {
        status: errores.length ? 'error' : 'synced',
        synced: ok,
        errors: errores,
        syncedLocalIds,
        syncedRecordIds,
        legacyWithoutOwner: pendientesLegacy.length,
        skippedOtherOwners: pendientesOtroUsuario.length,
      };
      syncDebug('finalizacion', result);
      return result;
    } catch (err) {
      syncError('error general', syncErrorInfo(err));
      if (showAlerts) {
        Alert.alert('Error', 'No se pudieron sincronizar los formularios.');
      }
      return { status: 'error', synced: 0, errors: [err?.message || 'Error de sincronización'] };
    } finally {
      contarFormulariosLocales();
      syncingRef.current = false;
      syncDebug('lock liberado');
    }
  }, [contarFormulariosLocales, isConnected, sesionOnlineValida, usuario]);

  const refrescarConteoNoLeidas = useCallback(async ({ silent = true } = {}) => {
    if (!usuario?.id) {
      setNotificacionesNoLeidas(0);
      return;
    }
    if (!isConnected) return;

    try {
      const total = await obtenerConteoNoLeidas(usuario.id);
      setNotificacionesNoLeidas(total);
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('⚠️ No se pudo consultar conteo de notificaciones:', e?.message || e);
      }
      if (!silent) {
        Alert.alert('Error', 'No se pudo actualizar el conteo de notificaciones.');
      }
    }
  }, [isConnected, usuario?.id]);

  const limpiarAccesoLocal = useCallback(async () => {
    await secureLocalStorage.removeItem('usuario_autenticado_local').catch(() => {});
    setVistaActiva('formulario');
    setNotificacionesNoLeidas(0);
    setSesionOnlineValida(false);
    setUsuario(null);
  }, []);

  const verificarSesion = useCallback(({ mostrarCarga = false } = {}) => {
    if (logoutEnCursoRef.current) return Promise.resolve(false);
    if (validacionSesionRef.current) {
      revalidarSesionRef.current = true;
      return validacionSesionRef.current;
    }

    const validacion = (async () => {
      if (mostrarCarga) setLoading(true);
      setSesionOnlineValida(false);
      let usuarioCache = null;
      try {
        const storedUser = await secureLocalStorage.getItem('usuario_autenticado_local');
        try {
          const parsed = storedUser ? JSON.parse(storedUser) : null;
          if (parsed?.id) usuarioCache = parsed;
        } catch {
          // Cache corrupto: la sesión persistida sigue siendo la fuente inicial.
        }

        let session = null;
        try {
          const { data, error } = await withTimeout(
            supabase.auth.getSession(),
            SESSION_TIMEOUT_MS,
            'La sesión local tardó demasiado en restaurarse.'
          );
          if (error) throw error;
          session = data?.session || null;
        } catch (sessionError) {
          if (esErrorAuthDefinitivo(sessionError)) {
            await supabase.auth.signOut().catch(() => {});
            await limpiarAccesoLocal();
            return false;
          }
          if (!logoutEnCursoRef.current && usuarioCache?.id && !usuarioRef.current?.id) setUsuario(usuarioCache);
          return false;
        }

        if (!session?.user?.id) {
          if (!isConnected && usuarioCache?.id) {
            const pinConfigurado = await hasOfflinePin(usuarioCache.id).catch(() => false);
            if (!logoutEnCursoRef.current) setUsuario(pinConfigurado ? null : usuarioCache);
            return false;
          }
          await limpiarAccesoLocal();
          return false;
        }

        const sessionUserId = session.user.id;
        const cacheMismoUsuario = usuarioCache?.id === sessionUserId ? usuarioCache : null;
        if (!isConnected) {
          if (usuarioRef.current?.id === sessionUserId) return false;
          const pinConfigurado = cacheMismoUsuario
            ? await hasOfflinePin(sessionUserId).catch(() => false)
            : false;
          if (!logoutEnCursoRef.current) setUsuario(pinConfigurado ? null : cacheMismoUsuario);
          return false;
        }

        let user;
        try {
          const { data, error } = await withTimeout(
            supabase.auth.getUser(),
            SESSION_TIMEOUT_MS,
            'La red tardó demasiado al verificar la sesión.'
          );
          if (error) throw error;
          user = data?.user || null;
        } catch (userError) {
          if (esErrorAuthDefinitivo(userError)) {
            await supabase.auth.signOut().catch(() => {});
            await limpiarAccesoLocal();
            return false;
          }
          if (!logoutEnCursoRef.current && cacheMismoUsuario && !usuarioRef.current?.id) setUsuario(cacheMismoUsuario);
          return false;
        }

        if (!user?.id || user.id !== sessionUserId) {
          await supabase.auth.signOut().catch(() => {});
          await limpiarAccesoLocal();
          return false;
        }

        const { data: perfil, error: errorPerfil } = await withTimeout(
          supabase
            .from('activadores')
            .select('*')
            .eq('usuario_id', user.id)
            .single(),
          QUERY_TIMEOUT_MS,
          'La red tardó demasiado al cargar el perfil.'
        );
        if (errorPerfil) {
          if (esPerfilAusente(errorPerfil)) {
            await supabase.auth.signOut().catch(() => {});
            await limpiarAccesoLocal();
          } else if (cacheMismoUsuario && !usuarioRef.current?.id) {
            if (!logoutEnCursoRef.current) setUsuario(cacheMismoUsuario);
          }
          return false;
        }
        if (!perfilTieneAcceso(perfil)) {
          await supabase.auth.signOut().catch(() => {});
          await limpiarAccesoLocal();
          return false;
        }

        const nombrePerfil = normalizarNombreVisible(perfil.nombre || '');
        const nombreCache = normalizarNombreVisible(cacheMismoUsuario?.nombre || '');
        const nombreMetadata = normalizarNombreVisible(user.user_metadata?.nombre || '');
        const plazaPerfil = normalizarNombreVisible(perfil.plaza || '');
        const plazaCache = normalizarNombreVisible(cacheMismoUsuario?.plaza || '');
        const plazasTemporales = await obtenerPlazasTemporales({
          activadorId: perfil.usuario_id,
          usuarioId: user.id,
        });

        let filasRoles = [];
        try {
          const { data: rolesData } = await withTimeout(
            supabase.from('activador_roles').select('rol').eq('usuario_id', user.id),
            QUERY_TIMEOUT_MS,
            'La red tardó demasiado al cargar los roles.'
          );
          if (Array.isArray(rolesData)) filasRoles = rolesData;
        } catch {
          // El perfil activo ya autorizó el acceso; se conserva el rol legacy.
        }
        const rolesCrudos = [
          perfil.rol || perfil.role,
          ...filasRoles.map((fila) => fila?.rol),
          ...(Array.isArray(cacheMismoUsuario?.roles) ? cacheMismoUsuario.roles : []),
        ].filter((rol) => typeof rol === 'string' && rol.trim());
        const usuarioFinal = {
          id: user.id,
          email: user.email,
          nombre: nombrePerfil || nombreCache || nombreMetadata || user.email,
          plaza: plazaPerfil || plazaCache || 'No especificada',
          plazas_temporales: plazasTemporales,
          rol: perfil.rol || perfil.role || cacheMismoUsuario?.rol || cacheMismoUsuario?.role || 'activador',
          roles: Array.from(new Set(rolesCrudos)),
          puede_activar: perfil.puede_activar === true,
        };

        if (logoutEnCursoRef.current) return false;
        await secureLocalStorage.setItem('usuario_autenticado_local', JSON.stringify(usuarioFinal));
        if (logoutEnCursoRef.current) {
          await secureLocalStorage.removeItem('usuario_autenticado_local');
          return false;
        }
        setUsuario(usuarioFinal);
        setSesionOnlineValida(true);
        return true;
      } catch (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('No se pudo validar la sesión; se conserva el estado local:', error?.message || error);
        }
        if (!logoutEnCursoRef.current && usuarioCache?.id && !usuarioRef.current?.id) setUsuario(usuarioCache);
        return false;
      } finally {
        contarFormulariosLocales();
        if (mostrarCarga) setLoading(false);
      }
    })();

    const validacionSeguida = validacion.finally(() => {
      if (validacionSesionRef.current === validacionSeguida) {
        validacionSesionRef.current = null;
        if (revalidarSesionRef.current) {
          revalidarSesionRef.current = false;
          globalThis.setTimeout(() => verificarSesion(), 0);
        }
      }
    });
    validacionSesionRef.current = validacionSeguida;
    return validacionSeguida;
  }, [contarFormulariosLocales, isConnected, limpiarAccesoLocal]);

  // Detectar cambios de conexión + estado inicial
  useEffect(() => {
    let mounted = true;
    const fallbackTimer = globalThis.setTimeout(() => {
      if (mounted) {
        setIsConnected((prev) => (prev === null ? false : prev));
      }
    }, 3000);

    NetInfo.fetch()
      .then((state) => {
        if (mounted) {
          setIsConnected(!!state?.isConnected);
        }
      })
      .catch(() => {
        if (mounted) {
          setIsConnected(false);
        }
      });

    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(!!state.isConnected);
    });

    return () => {
      mounted = false;
      globalThis.clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, []);

  // Verificar sesión una vez detectado el estado de conexión
  useEffect(() => {
    if (isConnected !== null) {
      verificarSesion({ mostrarCarga: !restauracionInicialCompletaRef.current }).finally(() => {
        restauracionInicialCompletaRef.current = true;
      });
    }
  }, [isConnected, verificarSesion]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') {
        logoutEnCursoRef.current = true;
        limpiarAccesoLocal();
        return;
      }
      if (logoutEnCursoRef.current) return;
      if (
        restauracionInicialCompletaRef.current
        && session?.user?.id
        && (
          ['TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)
          || (event === 'SIGNED_IN' && !!usuarioRef.current?.id)
        )
        && (!sesionOnlineValidaRef.current || usuarioRef.current?.id !== session.user.id)
      ) {
        verificarSesion();
      }
    });
    return () => data?.subscription?.unsubscribe();
  }, [limpiarAccesoLocal, verificarSesion]);

  // Auto-sync al volver a conexión o primer plano (sin alertas intrusivas)
  useEffect(() => {
    if (isConnected && sesionOnlineValida) {
      sincronizarFormularios({ showAlerts: false });
    }
  }, [isConnected, sesionOnlineValida, sincronizarFormularios]);

  useEffect(() => {
    if (usuario?.id && isConnected) {
      refrescarConteoNoLeidas();
    }
  }, [isConnected, refrescarConteoNoLeidas, usuario?.id]);

  useEffect(() => {
    if (!usuario?.id || !isConnected) return;

    const channel = supabase
      .channel(`rt-notificaciones-${usuario.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notificaciones_destinatarios',
          filter: `usuario_id=eq.${usuario.id}`,
        },
        () => {
          refrescarConteoNoLeidas();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isConnected, refrescarConteoNoLeidas, usuario?.id]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setIntroDone(true);
    }, MIN_BRANDED_INTRO_MS);
    return () => globalThis.clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Oculta rápido el splash nativo para que se vea la intro visual personalizada.
    if (!splashHiddenRef.current) {
      splashHiddenRef.current = true;
      SplashScreen.hideAsync().catch(() => {
        splashHiddenRef.current = false;
      });
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isConnected) {
        verificarSesion().then((sesionValida) => {
          if (!sesionValida) return;
          sincronizarFormularios({ showAlerts: false });
          refrescarConteoNoLeidas();
        });
      }
    });
    return () => sub.remove();
  }, [isConnected, refrescarConteoNoLeidas, sincronizarFormularios, verificarSesion]);

  const cerrarSesion = async () => {
    const usuarioIdLogout = usuarioRef.current?.id || null;
    logoutEnCursoRef.current = true;
    revalidarSesionRef.current = false;
    setSesionOnlineValida(false);
    setUsuario(null);
    try {
      await supabase.auth.stopAutoRefresh().catch(() => {});
      const { error } = await withTimeout(
        supabase.auth.signOut({ scope: 'global' }),
        SESSION_TIMEOUT_MS,
        'El cierre remoto de sesión tardó demasiado.'
      );
      if (error) throw error;
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('⚠️ Error cerrando sesión:', e.message);
      }
    } finally {
      let sesionLocalEliminada = false;
      for (let attempt = 0; attempt < 2 && !sesionLocalEliminada; attempt += 1) {
        try {
          await clearLocalSupabaseSession();
          sesionLocalEliminada = true;
        } catch {
          // Segundo intento inmediato: la limpieza local no depende de red.
        }
      }
      await Promise.allSettled([
        secureLocalStorage.removeItem('usuario_autenticado_local'),
        clearOfflinePin(usuarioIdLogout),
      ]);
      if (!sesionLocalEliminada) {
        Alert.alert('Cierre local incompleto', 'No se pudo eliminar la sesión guardada. Reinicia la app e intenta cerrar sesión nuevamente.');
      }
    }
    try {
      const pendientes = await obtenerFormulariosLocales();
      const fotosReferenciadas = pendientes.flatMap((item) => [
        item?.foto_url,
        item?.foto_cash_in,
        ...Object.values(item?._sync?.localPhotos || {}),
      ]);
      await limpiarFotosPendientesHuerfanas(fotosReferenciadas);
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('⚠️ No se pudieron limpiar fotos huérfanas:', e?.message || e);
      }
    }
    await limpiarAccesoLocal();
  };

  const handleLogin = async (user, { autenticadoOnline = false } = {}) => {
    logoutEnCursoRef.current = false;
    if (autenticadoOnline) supabase.auth.startAutoRefresh().catch(() => {});
    setSesionOnlineValida(autenticadoOnline);
    setUsuario(user);
    setVistaActiva('formulario');
    contarFormulariosLocales();
  };

  const normalizarPinLocal = (value) =>
    String(value || '').replace(/\D/g, '').slice(0, pinPolicy.maxLength);

  const refrescarEstadoPin = useCallback(async () => {
    if (!usuario?.id) {
      setPinConfigurado(false);
      return;
    }
    try {
      setPinConfigurado(await hasOfflinePin(usuario.id));
    } catch {
      setPinConfigurado(false);
    }
  }, [usuario?.id]);

  useEffect(() => {
    refrescarEstadoPin();
  }, [refrescarEstadoPin]);

  const abrirPinModal = () => {
    setPinNuevo('');
    setPinConfirm('');
    setPinModalVisible(true);
  };

  const guardarPinLocal = async () => {
    if (pinGuardando) return;
    if (!usuario?.id) return;

    const pin = normalizarPinLocal(pinNuevo);
    const confirm = normalizarPinLocal(pinConfirm);
    if (pin.length < pinPolicy.minLength || pin.length > pinPolicy.maxLength) {
      Alert.alert('PIN inválido', `El PIN debe tener entre ${pinPolicy.minLength} y ${pinPolicy.maxLength} dígitos.`);
      return;
    }
    if (pin !== confirm) {
      Alert.alert('PIN no coincide', 'La confirmación debe ser exactamente igual.');
      return;
    }

    setPinGuardando(true);
    try {
      await saveOfflinePin({ userId: usuario.id, pin });
      let status;
      try {
        status = await getOfflinePinStatus(usuario.id);
      } catch (verifyError) {
        throw new Error(`El PIN se guardó, pero no pudo verificarse. ${verifyError?.message || 'Intenta nuevamente.'}`);
      }
      if (!status?.configured) {
        throw new Error('El PIN se guardó, pero no pudo verificarse. Intenta nuevamente.');
      }
      setPinConfigurado(true);
      setPinModalVisible(false);
      setPinNuevo('');
      setPinConfirm('');
      Alert.alert('PIN guardado', 'Tu PIN local quedó activo para desbloqueo sin internet.');
    } catch (err) {
      Alert.alert('No se pudo guardar PIN', err?.message || 'Intenta de nuevo.');
    } finally {
      setPinGuardando(false);
    }
  };

  const firstName = enmascararMarcaVisible(usuario?.nombre?.split(' ')[0] || 'Usuario', usuario);
  const normalizarRol = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  // Conjunto multirrol: activador_roles + rol legacy de activadores (+ cache offline).
  const rolesNormalizados = [...new Set(
    [usuario?.rol, usuario?.role, ...(Array.isArray(usuario?.roles) ? usuario.roles : [])]
      .map(normalizarRol)
      .filter(Boolean)
  )];
  const rolesBase = rolesNormalizados.length ? rolesNormalizados : ['activador'];
  // Compatibilidad con strings legacy compuestos (p. ej. 'lider_activador'): se
  // interpretan como ambas capacidades sin crear roles nuevos.
  const esRolCompuestoLegacy = (rol) =>
    ['lider_activador', 'activador_lider', 'leader_activator', 'activator_leader'].includes(rol)
    || ((rol.includes('lider') || rol.includes('leader')) && rol.includes('activador'));
  const esAdministrador = rolesBase.some(
    (rol) => ['admin', 'administrador', 'administrator'].some(
      (base) => rol === base || rol.startsWith(`${base}_`),
    ),
  );
  const esLider = rolesBase.some(
    (rol) => ['lider', 'leader', 'supervisor'].some(
      (base) => rol === base || rol.startsWith(`${base}_`),
    ) || esRolCompuestoLegacy(rol),
  );
  const esActivadorOperativo = rolesBase.some(
    (rol) => rol === 'activador' || rol.startsWith('activador_') || esRolCompuestoLegacy(rol),
  );
  const liderPuedeActivar = esLider && usuario?.puede_activar === true;
  const puedeFormulario = esAdministrador || esActivadorOperativo || !esLider || liderPuedeActivar;
  const puedeActivaciones = esAdministrador || esActivadorOperativo || !esLider || liderPuedeActivar;
  const puedeControl = esAdministrador || esLider || esActivadorOperativo;
  const vistasPermitidas = [
    ...(puedeFormulario ? ['formulario'] : []),
    ...(puedeControl ? ['control'] : []),
    ...(puedeActivaciones ? ['activaciones'] : []),
    'notificaciones',
  ];
  const vistaSegura = vistasPermitidas.includes(vistaActiva) ? vistaActiva : vistasPermitidas[0];
  const offlineLabel = `${cantidadOffline} pendiente${cantidadOffline === 1 ? '' : 's'}`;
  const vistaLabel = vistaSegura === 'activaciones'
    ? 'Vista historial'
    : vistaSegura === 'control'
      ? 'Métricas'
    : vistaSegura === 'notificaciones'
      ? 'Vista notificaciones'
      : 'Vista formulario';

  if (!HAS_SUPABASE_CONFIG) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Configuración incompleta</Text>
        <Text style={styles.errorText}>{SUPABASE_CONFIG_ERROR}</Text>
      </View>
    );
  }

  if (loading || !introDone) return <LaunchIntroScreen />;

  if (!usuario) return <AuthScreen onLogin={handleLogin} />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.brand}>Impulsa 360</Text>
            <Text style={styles.bienvenida}>Hola, {firstName}</Text>
            <Text style={styles.meta}>
              {offlineLabel} · {vistaLabel}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <View style={[styles.statusChip, isConnected ? styles.statusOnline : styles.statusOffline]}>
              <Text style={styles.statusText}>{isConnected ? 'En línea' : 'Sin red'}</Text>
            </View>
            {sesionOnlineValida ? (
              <TouchableOpacity style={styles.logoutLink} onPress={abrirPinModal}>
                <Text style={styles.logoutLinkText}>{pinConfigurado ? 'Cambiar PIN' : 'Configurar PIN'}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.logoutLink} onPress={cerrarSesion}>
              <Text style={styles.logoutLinkText}>Salir</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.tabsRow}>
          {puedeFormulario && <TouchableOpacity
            style={[styles.tabBtn, vistaSegura === 'formulario' ? styles.tabBtnActive : null]}
            onPress={() => setVistaActiva('formulario')}
          >
            <Text style={[styles.tabBtnText, vistaSegura === 'formulario' ? styles.tabBtnTextActive : null]}>
              Formulario
            </Text>
          </TouchableOpacity>}

          {puedeControl && <TouchableOpacity
            style={[styles.tabBtn, vistaSegura === 'control' ? styles.tabBtnActive : null]}
            onPress={() => setVistaActiva('control')}
          >
            <Text style={[styles.tabBtnText, vistaSegura === 'control' ? styles.tabBtnTextActive : null]}>
              Métricas
            </Text>
          </TouchableOpacity>}

          {puedeActivaciones && <TouchableOpacity
            style={[styles.tabBtn, vistaSegura === 'activaciones' ? styles.tabBtnActive : null]}
            onPress={() => setVistaActiva('activaciones')}
          >
            <Text style={[styles.tabBtnText, vistaSegura === 'activaciones' ? styles.tabBtnTextActive : null]}>
              Activaciones
            </Text>
          </TouchableOpacity>}

          <TouchableOpacity
            style={[styles.tabBtn, vistaSegura === 'notificaciones' ? styles.tabBtnActive : null]}
            onPress={() => setVistaActiva('notificaciones')}
          >
            <Text style={[styles.tabBtnText, vistaSegura === 'notificaciones' ? styles.tabBtnTextActive : null]}>
              Notificaciones
            </Text>
            {notificacionesNoLeidas > 0 ? (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>
                  {notificacionesNoLeidas > 99 ? '99+' : String(notificacionesNoLeidas)}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

      </View>

      <View style={styles.body}>
        {vistaSegura === 'activaciones' ? (
          <FormulariosPorImpulsador usuario={usuario} onSincronizar={sincronizarFormularios} />
        ) : vistaSegura === 'control' ? (
          <ControlActivadores usuario={usuario} isConnected={isConnected} />
        ) : vistaSegura === 'notificaciones' ? (
          <NotificacionesScreen
            usuarioId={usuario?.id}
            usuario={usuario}
            onUnreadCountChange={setNotificacionesNoLeidas}
          />
        ) : (
          <FormularioActivacion
            cantidadOffline={cantidadOffline}
            contarFormulariosLocales={contarFormulariosLocales}
            isConnected={isConnected}
            onSincronizar={sincronizarFormularios}
            onVerActivaciones={() => setVistaActiva('activaciones')}
            usuario={usuario}
          />
        )}
      </View>

      <Modal visible={pinModalVisible} transparent animationType="fade" onRequestClose={() => { if (!pinGuardando) setPinModalVisible(false); }}>
        <View style={styles.pinModalBackdrop}>
          <View style={styles.pinModalCard}>
            <Text style={styles.pinModalTitle}>{pinConfigurado ? 'Cambiar PIN local' : 'Configurar PIN local'}</Text>
            <Text style={styles.pinModalSub}>
              PIN de {pinPolicy.minLength} a {pinPolicy.maxLength} dígitos para desbloquear sin internet.
            </Text>
            <TextInput
              style={styles.pinInput}
              placeholder="Nuevo PIN"
              value={pinNuevo}
              onChangeText={(v) => setPinNuevo(normalizarPinLocal(v))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={pinPolicy.maxLength}
              editable={!pinGuardando}
            />
            <TextInput
              style={styles.pinInput}
              placeholder="Confirmar PIN"
              value={pinConfirm}
              onChangeText={(v) => setPinConfirm(normalizarPinLocal(v))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={pinPolicy.maxLength}
              editable={!pinGuardando}
            />
            <View style={styles.pinModalActions}>
              <TouchableOpacity
                style={[styles.pinBtnSecondary, pinGuardando && styles.pinBtnDisabled]}
                onPress={() => { if (!pinGuardando) setPinModalVisible(false); }}
                disabled={pinGuardando}
                activeOpacity={0.85}
              >
                <Text style={styles.pinBtnSecondaryText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pinBtnPrimary, pinGuardando && styles.pinBtnDisabled]}
                onPress={guardarPinLocal}
                disabled={pinGuardando}
                activeOpacity={0.85}
              >
                {pinGuardando ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.pinBtnPrimaryText}>Guardar PIN</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: fontSizes.large,
    fontWeight: '700',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  errorText: {
    color: colors.text,
    fontSize: fontSizes.medium,
    textAlign: 'center',
  },
  header: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.headerBg,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    shadowColor: '#08131F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 6,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  headerTextWrap: {
    flex: 1,
    marginRight: spacing.md,
  },
  brand: {
    color: '#AFC4DB',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  bienvenida: {
    fontSize: fontSizes.large,
    color: colors.headerText,
    fontWeight: '700',
  },
  meta: {
    color: '#CDDBEA',
    fontSize: fontSizes.small,
    marginTop: 2,
  },
  statusChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  statusOnline: {
    backgroundColor: 'rgba(15, 169, 104, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(111, 221, 173, 0.5)',
  },
  statusOffline: {
    backgroundColor: 'rgba(214, 58, 69, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 144, 153, 0.45)',
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  headerActions: {
    alignItems: 'flex-end',
  },
  logoutLink: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    marginTop: 2,
  },
  logoutLinkText: {
    color: '#AFC4DB',
    fontSize: 12,
    fontWeight: '600',
  },
  pinModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 10, 18, 0.6)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pinModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
  },
  pinModalTitle: {
    fontSize: fontSizes.large,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  pinModalSub: {
    fontSize: fontSizes.small,
    color: colors.muted,
    marginBottom: spacing.md,
  },
  pinInput: {
    borderWidth: 1,
    borderColor: '#CBDCEC',
    borderRadius: 10,
    padding: spacing.md,
    fontSize: fontSizes.medium,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pinModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
  },
  pinBtnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minWidth: 120,
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  pinBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  pinBtnSecondary: {
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  pinBtnSecondaryText: {
    color: colors.primary,
    fontWeight: '700',
  },
  pinBtnDisabled: {
    opacity: 0.6,
  },
  actionsRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.xs,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    minHeight: 44,
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
    borderColor: 'rgba(255, 255, 255, 0.38)',
  },
  tabBtnText: {
    color: '#DCE8F5',
    fontSize: 12,
    fontWeight: '700',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
  },
  tabBadge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 20,
    height: 20,
    borderRadius: 999,
    paddingHorizontal: 5,
    backgroundColor: '#D63A45',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  actionBtnGhost: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnGhostText: {
    color: '#E5EEF8',
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
});
