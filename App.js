// App.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  Alert,
  StyleSheet,
  AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import * as SplashScreen from 'expo-splash-screen';
import { v4 as uuidv4 } from 'uuid';

import { supabase } from './lib/supabase';
import { HAS_SUPABASE_CONFIG, SUPABASE_CONFIG_ERROR } from './lib/config';
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
import { ACTIVACIONES_BUCKET, subirImagenASupabase } from './lib/upload';
import { hasOfflinePin } from './lib/offlinePin';
import { obtenerConteoNoLeidas } from './lib/notificaciones';

const MIN_BRANDED_INTRO_MS = 3200;
const SESSION_TIMEOUT_MS = 8000;
const QUERY_TIMEOUT_MS = 10000;
const SYNC_UPSERT_TIMEOUT_MS = 12000;
const PHOTO_UPLOAD_TIMEOUT_MS = 45000;
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
const isLocalPhotoUri = (value) => typeof value === 'string' && /^(file|content):\/\//i.test(value);
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
  const { data, error } = await withTimeout(
    supabase.storage.from(ACTIVACIONES_BUCKET).download(path),
    QUERY_TIMEOUT_MS,
    'La red está tardando demasiado al verificar la foto remota.'
  );
  if (error) {
    syncWarn('foto remota no encontrada', { path, error: syncErrorInfo(error) });
    return false;
  }
  return !!data;
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
  const syncingRef = useRef(false);
  const lastSyncRef = useRef(0);
  const splashHiddenRef = useRef(false);

  const contarFormulariosLocales = useCallback(async () => {
    const datos = await obtenerFormulariosLocales();
    setCantidadOffline(datos.length);
  }, []);

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

    const now = Date.now();
    if (!showAlerts && !force && now - lastSyncRef.current < 10000) return { status: 'busy', synced: 0, errors: [] };
    lastSyncRef.current = now;

    syncingRef.current = true;
    syncDebug('inicio', { force, showAlerts });
    try {
      const todosFormularios = await obtenerFormulariosLocales();
      const formularios = targetLocalId
        ? todosFormularios.filter((f) => f?._id_local === targetLocalId || f?.id === targetLocalId)
        : todosFormularios;
      syncDebug('formularios pendientes', { count: formularios.length });
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
          Alert.alert('Sin formularios', 'No hay formularios pendientes.');
        }
        return { status: 'empty', synced: 0, errors: [] };
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
        const effectiveFotoUrl = formulario.foto_url || localPhotosForCleanup.foto_url;
        const effectiveFotoCashIn = formulario.foto_cash_in || localPhotosForCleanup.foto_cash_in;

        if (!effectiveFotoUrl || !effectiveFotoCashIn) {
          syncWarn('fotos obligatorias faltantes', { localId, recordId });
          const errorMsg = 'Faltan las dos fotos obligatorias.';
          await marcarErrorSync(localId, errorMsg);
          errores.push(`ID local ${localId}: ${errorMsg}`);
          continue;
        }

        // Sube imágenes pendientes
        const fotoKeys = ['foto_url', 'foto_cash_in'];
        let fotoUploadFailed = false;
        syncDebug('rehydratedUri', { localId, recordId, localPhotos: localPhotosForCleanup });
        for (const key of fotoKeys) {
          const fieldUri = formulario[key] || localPhotosForCleanup[key];
          const preferredLocalUri = localPhotosForCleanup[key];
          const uploadSourceUri = isLocalPhotoUri(preferredLocalUri) ? preferredLocalUri : fieldUri;
          const fieldAlreadyRemote = typeof fieldUri === 'string' && fieldUri && !isLocalPhotoUri(fieldUri);
          const shouldUploadLocal = isLocalPhotoUri(uploadSourceUri) && !fieldAlreadyRemote;

          if (shouldUploadLocal) {
            const fileInfo = await FileSystem.getInfoAsync(uploadSourceUri, { size: true }).catch(() => null);
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
              await marcarErrorSync(localId, errorMsg);
              errores.push(`ID local ${localId}: ${errorMsg}`);
              fotoUploadFailed = true;
              continue;
            }
            try {
              const path = buildPhotoStoragePath(usuario.id, recordId, key);
              syncDebug(key === 'foto_cash_in' ? 'cash-in upload' : 'foto activacion upload', { localId, recordId, path });
              const storagePath = await withTimeout(
                subirImagenASupabase(uploadSourceUri, path),
                PHOTO_UPLOAD_TIMEOUT_MS,
                'La señal está muy débil para subir la foto. Se reintentará luego.'
              );
              if (storagePath) {
                formulario[key] = storagePath;
                localPhotosForCleanup[key] = uploadSourceUri;
                await actualizarFormularioLocal(localId, {
                  [key]: storagePath,
                  _sync: {
                    ...(_sync || {}),
                    status: 'pending',
                    error: null,
                    localPhotos: localPhotosForCleanup,
                  },
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
              await marcarErrorSync(localId, errorMsg);
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

        // Añade datos del usuario actual
        const nombreImpulsador = normalizarNombreVisible(usuario?.nombre || '');
        const plazaFallback = tienePlazaValida(usuario?.plaza) ? usuario.plaza : null;
        const datosConUsuario = {
          ...payload,
          id: recordId,
          usuario_id: usuario?.id,
          impulsador: nombreImpulsador || payload.impulsador || usuario?.email || '',
          plaza: payload.plaza || plazaFallback,
          estado_sync: 'online',
        };

        const { error } = await withTimeout(
          supabase.from('activaciones').upsert(datosConUsuario, { onConflict: 'id' }),
          SYNC_UPSERT_TIMEOUT_MS,
          'La señal está muy débil para sincronizar. Se reintentará luego.'
        );
        syncDebug('upsert', { localId, recordId, ok: !error });

        if (!error) {
          const cleanupUris = Object.values(localPhotosForCleanup)
            .filter((uri) => typeof uri === 'string' && /^file:\/\//i.test(uri));
          await Promise.all(cleanupUris.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})));
          syncDebug('cleanup final fotos locales', { localId, recordId, count: cleanupUris.length });
          await eliminarFormularioLocal(localId);
          ok += 1;
          syncedLocalIds.push(localId);
          syncedRecordIds.push(recordId);
        } else {
          syncError('fallo upsert activacion', { localId, recordId, error: syncErrorInfo(error) });
          const errorMsg = `Upsert activacion: ${syncErrorMessage(error)}`;
          await marcarErrorSync(localId, errorMsg);
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
  }, [contarFormulariosLocales, isConnected, usuario]);

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

  const verificarSesion = useCallback(async () => {
    setLoading(true);
    let storedUser = null;
    let usuarioCache = null;
    try {
      // Siempre intenta cargar usuario local primero (útil si tarda la red)
      storedUser = await AsyncStorage.getItem('usuario_autenticado_local');
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          if (parsed?.id) {
            usuarioCache = parsed;
          }
        } catch {
          // ignorar usuario local corrupto
        }
      }

      if (!isConnected) {
        if (usuario?.id) return;
        if (!storedUser) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('⚠️ No se encontró usuario local (offline).');
          }
          setUsuario(null);
          return;
        }
        if (usuarioCache?.id) {
          const pinConfigurado = await hasOfflinePin(usuarioCache.id);
          if (pinConfigurado) {
            // Fuerza desbloqueo con PIN local cuando no hay red.
            setUsuario(null);
          } else {
            setUsuario(usuarioCache);
          }
        } else {
          setUsuario(null);
        }
      } else {
        const { data: { user }, error } = await withTimeout(
          supabase.auth.getUser(),
          SESSION_TIMEOUT_MS,
          'La red tardó demasiado al verificar la sesión.'
        );
        if (error || !user) throw new Error(error?.message || 'No user');

        const { data: perfil, error: errorPerfil } = await withTimeout(
          supabase
            .from('activadores')
            .select('*')
            .eq('usuario_id', user.id)
            .single(),
          QUERY_TIMEOUT_MS,
          'La red tardó demasiado al cargar el perfil.'
        );

        if (errorPerfil && typeof __DEV__ !== 'undefined' && __DEV__) console.warn('⚠️ Perfil no encontrado:', errorPerfil.message);

        const cacheMismoUsuario = usuarioCache?.id === user.id ? usuarioCache : null;
        const nombrePerfil = normalizarNombreVisible(perfil?.nombre || '');
        const nombreCache = normalizarNombreVisible(cacheMismoUsuario?.nombre || '');
        const nombreMetadata = normalizarNombreVisible(user.user_metadata?.nombre || '');
        const plazaPerfil = normalizarNombreVisible(perfil?.plaza || '');
        const plazaCache = normalizarNombreVisible(cacheMismoUsuario?.plaza || '');
        const plazasTemporales = await obtenerPlazasTemporales({
          activadorId: perfil?.usuario_id,
          usuarioId: user.id,
        });

        const usuarioFinal = {
          id: user.id,
          email: user.email,
          nombre: nombrePerfil || nombreCache || nombreMetadata || user.email,
          plaza: plazaPerfil || plazaCache || 'No especificada',
          plazas_temporales: plazasTemporales,
          rol: perfil?.rol || perfil?.role || cacheMismoUsuario?.rol || cacheMismoUsuario?.role || user.user_metadata?.rol || user.user_metadata?.role || 'activador',
          puede_activar: perfil?.puede_activar === true || cacheMismoUsuario?.puede_activar === true,
        };

        setUsuario(usuarioFinal);
        await AsyncStorage.setItem('usuario_autenticado_local', JSON.stringify(usuarioFinal));
      }
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('❌ Error verificando sesión:', e?.message || e);
      }
      if (usuarioCache?.id && !usuario?.id) {
        const pinConfigurado = await hasOfflinePin(usuarioCache.id);
        setUsuario(pinConfigurado ? null : usuarioCache);
      } else if (!usuario?.id) {
        setUsuario(null);
      }
    } finally {
      contarFormulariosLocales();
      setLoading(false);
    }
  }, [contarFormulariosLocales, isConnected, usuario?.id]);

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
      verificarSesion();
    }
  }, [isConnected, verificarSesion]);

  // Auto-sync al volver a conexión o primer plano (sin alertas intrusivas)
  useEffect(() => {
    if (isConnected) {
      sincronizarFormularios({ showAlerts: false });
    }
  }, [isConnected, sincronizarFormularios]);

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
        sincronizarFormularios({ showAlerts: false });
        refrescarConteoNoLeidas();
      }
    });
    return () => sub.remove();
  }, [isConnected, refrescarConteoNoLeidas, sincronizarFormularios]);

  const cerrarSesion = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('⚠️ Error cerrando sesión:', e.message);
      }
    }
    await AsyncStorage.removeItem('usuario_autenticado_local');
    setVistaActiva('formulario');
    setNotificacionesNoLeidas(0);
    setUsuario(null);
  };

  const handleLogin = async (user) => {
    setUsuario(user);
    setVistaActiva('formulario');
    contarFormulariosLocales();
  };

  const firstName = enmascararMarcaVisible(usuario?.nombre?.split(' ')[0] || 'Usuario', usuario);
  const rolNormalizado = String(usuario?.rol || usuario?.role || 'activador')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const esAdministrador = ['admin', 'administrador', 'administrator'].some(
    (rol) => rolNormalizado === rol || rolNormalizado.startsWith(`${rol}_`),
  );
  const esHibrido =
    ['lider_activador', 'activador_lider', 'leader_activator', 'activator_leader'].includes(rolNormalizado)
    || ((rolNormalizado.includes('lider') || rolNormalizado.includes('leader')) && rolNormalizado.includes('activador'));
  const esLider =
    ['lider', 'leader', 'supervisor'].some(
      (rol) => rolNormalizado === rol || rolNormalizado.startsWith(`${rol}_`),
    )
    || esHibrido;
  const liderPuedeActivar = esLider && usuario?.puede_activar === true;
  const puedeFormulario = esAdministrador || !esLider || esHibrido || liderPuedeActivar;
  const puedeActivaciones = esAdministrador || !esLider || esHibrido || liderPuedeActivar;
  const puedeControl = esAdministrador || esLider;
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
