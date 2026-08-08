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
import * as FileSystem from 'expo-file-system';
import * as SplashScreen from 'expo-splash-screen';
import { v4 as uuidv4 } from 'uuid';

import { supabase } from './lib/supabase';
import { HAS_SUPABASE_CONFIG, SUPABASE_CONFIG_ERROR } from './lib/config';
import { colors, spacing, fontSizes } from './styles/theme';
import { normalizarNombreVisible } from './lib/identity';
import { obtenerPlazasTemporales } from './lib/plazasTemporales';
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
} from './lib/storage';
import { subirImagenASupabase } from './lib/upload';
import { hasOfflinePin } from './lib/offlinePin';
import { obtenerConteoNoLeidas } from './lib/notificaciones';

const MIN_BRANDED_INTRO_MS = 3200;
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
    console.error('❌ Error en el arranque de la app:', error?.message || error, errorInfo);
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

  const sincronizarFormularios = useCallback(async ({ showAlerts = true, force = false } = {}) => {
    if (syncingRef.current) return { status: 'busy', synced: 0, errors: [] };
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
    try {
      const formularios = await obtenerFormulariosLocales();
      if (!formularios.length) {
        if (showAlerts) {
          Alert.alert('Sin formularios', 'No hay formularios pendientes.');
        }
        return { status: 'empty', synced: 0, errors: [] };
      }

      let ok = 0;
      const errores = [];
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

        // Asegura fecha
        formulario.fecha_activacion ??= new Date().toISOString().split('T')[0];
        formulario.estado_sync ??= 'offline_pending';
        // Limpia campos que no existan en la tabla
        delete formulario.fecha_hora;

        if (!formulario.foto_url || !formulario.foto_cash_in) {
          errores.push(`ID local ${localId}: Faltan las dos fotos obligatorias.`);
          continue;
        }

        // Sube imágenes pendientes
        const fotoKeys = ['foto_url', 'foto_cash_in'];
        let fotoUploadFailed = false;
        for (const key of fotoKeys) {
          const fotoLocalUri = formulario[key];
          const isLocalPhotoUri = typeof fotoLocalUri === 'string' && /^(file|content):\/\//i.test(fotoLocalUri);
          if (isLocalPhotoUri) {
            const fileInfo = await FileSystem.getInfoAsync(fotoLocalUri, { size: true }).catch(() => null);
            if (!fileInfo?.exists) {
              errores.push(`ID local ${localId}: La foto (${key}) ya no está en el dispositivo. Debes tomarla nuevamente.`);
              fotoUploadFailed = true;
              continue;
            }
            try {
              const fileName = key === 'foto_cash_in' ? 'cash-in.jpg' : 'principal.jpg';
              const path = `activaciones/${usuario.id}/${recordId}/${fileName}`;
              const storagePath = await subirImagenASupabase(fotoLocalUri, path);
              if (storagePath) {
                formulario[key] = storagePath;
                await actualizarFormularioLocal(localId, { [key]: storagePath });
                // Si el upload fue exitoso, limpiamos la copia local persistida.
                await FileSystem.deleteAsync(fotoLocalUri, { idempotent: true }).catch(() => {});
              } else {
                errores.push(`ID local ${localId}: No se pudo subir la foto (${key})`);
                fotoUploadFailed = true;
                continue;
              }
            } catch (e) {
              console.warn(`⚠️ No se pudo subir foto (${key}) del formulario ${localId}:`, e?.message || e);
              errores.push(`ID local ${localId}: No se pudo subir la foto (${key})`);
              fotoUploadFailed = true;
              continue;
            }
          }
        }
        if (fotoUploadFailed) {
          continue;
        }

        // Solo enviamos columnas permitidas para evitar errores de esquema
        const payload = allowedFields.reduce((acc, key) => {
          if (formulario[key] !== undefined) acc[key] = formulario[key];
          return acc;
        }, {});

        // Añade datos del usuario actual
        const nombreImpulsador = normalizarNombreVisible(usuario?.nombre || '');
        const datosConUsuario = {
          ...payload,
          id: recordId,
          usuario_id: usuario?.id,
          impulsador: nombreImpulsador || payload.impulsador || usuario?.email || '',
          plaza: payload.plaza || usuario?.plaza,
          estado_sync: 'online',
        };

        const { error } = await supabase
          .from('activaciones')
          .upsert(datosConUsuario, { onConflict: 'id' });

        if (!error) {
          await eliminarFormularioLocal(localId);
          ok += 1;
        } else {
          console.error(`❌ Error en formulario ${localId}:`, error.message);
          errores.push(`ID local ${localId}: ${error.message}`);
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
      return { status: errores.length ? 'error' : 'synced', synced: ok, errors: errores };
    } catch (err) {
      console.error('❌ Error general al sincronizar:', err?.message || err);
      if (showAlerts) {
        Alert.alert('Error', 'No se pudieron sincronizar los formularios.');
      }
      return { status: 'error', synced: 0, errors: [err?.message || 'Error de sincronización'] };
    } finally {
      contarFormulariosLocales();
      syncingRef.current = false;
    }
  }, [contarFormulariosLocales, isConnected, usuario?.email, usuario?.id, usuario?.nombre, usuario?.plaza]);

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
      console.warn('⚠️ No se pudo consultar conteo de notificaciones:', e?.message || e);
      if (!silent) {
        Alert.alert('Error', 'No se pudo actualizar el conteo de notificaciones.');
      }
    }
  }, [isConnected, usuario?.id]);

  const verificarSesion = useCallback(async () => {
    setLoading(true);
    try {
      // Siempre intenta cargar usuario local primero (útil si tarda la red)
      const storedUser = await AsyncStorage.getItem('usuario_autenticado_local');
      let usuarioCache = null;
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
          console.warn('⚠️ No se encontró usuario local (offline).');
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
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) throw new Error(error?.message || 'No user');

        const { data: perfil, error: errorPerfil } = await supabase
          .from('activadores')
          .select('*')
          .eq('usuario_id', user.id)
          .single();

        if (errorPerfil) console.warn('⚠️ Perfil no encontrado:', errorPerfil.message);

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
      console.error('❌ Error verificando sesión:', e?.message || e);
      setUsuario(null);
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
      console.warn('⚠️ Error cerrando sesión:', e.message);
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

  const firstName = usuario?.nombre?.split(' ')[0] || 'Usuario';
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
          <FormulariosPorImpulsador usuario={usuario} />
        ) : vistaSegura === 'control' ? (
          <ControlActivadores usuario={usuario} isConnected={isConnected} />
        ) : vistaSegura === 'notificaciones' ? (
          <NotificacionesScreen
            usuarioId={usuario?.id}
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
