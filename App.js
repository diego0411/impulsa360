// App.js
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Alert,
  StyleSheet,
  AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { v4 as uuidv4 } from 'uuid';

import { supabase } from './lib/supabase';
import { colors, spacing, fontSizes } from './styles/theme';
import AuthScreen from './components/AuthScreen';
import FormularioActivacion from './components/FormularioActivacion';
import FormulariosPorImpulsador from './components/FormulariosPorImpulsador';
import {
  obtenerFormulariosLocales,
  eliminarFormularioLocal,
  actualizarFormularioLocal,
} from './lib/storage';
import { subirImagenASupabase } from './lib/upload';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cantidadOffline, setCantidadOffline] = useState(0);
  const [isConnected, setIsConnected] = useState(null);
  const [verActivaciones, setVerActivaciones] = useState(false);
  const syncingRef = useRef(false);

  // Detectar cambios de conexión + estado inicial
  useEffect(() => {
    NetInfo.fetch().then(state => setIsConnected(!!state.isConnected));
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
    });
    return unsubscribe;
  }, []);

  // Verificar sesión una vez detectado el estado de conexión
  useEffect(() => {
    if (isConnected !== null) verificarSesion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // Auto-sync al volver a conexión o primer plano
  useEffect(() => {
    if (isConnected) {
      sincronizarFormularios();
    }
  }, [isConnected]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isConnected) {
        sincronizarFormularios();
      }
    });
    return () => sub.remove();
  }, [isConnected]);

  const verificarSesion = async () => {
    setLoading(true);
    try {
      // Siempre intenta cargar usuario local primero (útil si tarda la red)
      const storedUser = await AsyncStorage.getItem('usuario_autenticado_local');
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          if (parsed?.id) setUsuario(parsed);
        } catch {}
      }

      if (!isConnected) {
        if (!storedUser) console.warn('⚠️ No se encontró usuario local (offline).');
      } else {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) throw new Error(error?.message || 'No user');

        const { data: perfil, error: errorPerfil } = await supabase
          .from('activadores')
          .select('*')
          .eq('usuario_id', user.id)
          .single();

        if (errorPerfil) console.warn('⚠️ Perfil no encontrado:', errorPerfil.message);

        const usuarioFinal = {
          id: user.id,
          email: user.email,
          nombre: perfil?.nombre?.trim() || user.user_metadata?.nombre || user.email,
          plaza: perfil?.plaza?.trim() || 'No especificada',
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
  };

  const contarFormulariosLocales = async () => {
    const datos = await obtenerFormulariosLocales();
    setCantidadOffline(datos.length);
  };

  const sincronizarFormularios = async () => {
    if (syncingRef.current) return;
    if (!usuario?.id) {
      Alert.alert('Sesión requerida', 'Vuelve a iniciar sesión antes de sincronizar.');
      return;
    }
    if (!isConnected) {
      Alert.alert('Sin conexión', 'Conéctate a internet para sincronizar.');
      return;
    }
    syncingRef.current = true;
    try {
      const formularios = await obtenerFormulariosLocales();
      if (!formularios.length) {
        Alert.alert('Sin formularios', 'No hay formularios pendientes.');
        return;
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
        'tipo_activacion',
        'base_activacion',
        'es_reactivacion',
        'tamano_tienda',
        'tipo_comercio',
        'foto_url',
        'foto_respaldo_url',
        'fecha_activacion',
        'latitud',
        'longitud',
        'reactivacion_comercio',
        'respaldo',
        'ciudad_activacion',
        'zona_activacion',
        'estado_sync',
        'dispositivo',
      ];

      for (const f of formularios) {
        // En tu storage nuevo puede existir _id_local; mantenemos compatibilidad
        const localId = f._id_local ?? f.id;

        // Clonamos para no mutar el original
        const { id: _omit, _id_local, _created_at, _updated_at, _sync, ...formulario } = f;

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

        // Sube imágenes pendientes
        const fotoKeys = ['foto_url', 'foto_respaldo_url'];
        for (const key of fotoKeys) {
          if (formulario[key]?.startsWith?.('file://')) {
            try {
              const path = key === 'foto_respaldo_url'
                ? `activaciones/${recordId}_respaldo.jpg`
                : `activaciones/${recordId}.jpg`;
              const storagePath = await subirImagenASupabase(formulario[key], path);
              if (storagePath) {
                formulario[key] = storagePath;
                await actualizarFormularioLocal(localId, { [key]: storagePath });
              } else {
                errores.push(`ID local ${localId}: No se pudo subir la foto (${key})`);
                continue;
              }
            } catch (e) {
              console.warn(`⚠️ No se pudo subir foto (${key}) del formulario ${localId}:`, e?.message || e);
              errores.push(`ID local ${localId}: No se pudo subir la foto (${key})`);
              continue;
            }
          }
        }

        // Solo enviamos columnas permitidas para evitar errores de esquema
        const payload = allowedFields.reduce((acc, key) => {
          if (formulario[key] !== undefined) acc[key] = formulario[key];
          return acc;
        }, {});

        // Añade datos del usuario actual
        const datosConUsuario = {
          ...payload,
          id: recordId,
          usuario_id: usuario?.id,
          impulsador: usuario?.nombre,
          plaza: usuario?.plaza,
          estado_sync: 'online',
        };

        const { error } = await supabase
          .from('activaciones')
          .upsert(datosConUsuario, { onConflict: 'id' });

        if (!error) {
          await eliminarFormularioLocal(localId);
          ok += 1;
          await contarFormulariosLocales();
        } else {
          console.error(`❌ Error en formulario ${localId}:`, error.message);
          errores.push(`ID local ${localId}: ${error.message}`);
        }
      }

      // Resumen
      if (errores.length === 0) {
        Alert.alert('Sincronización completa', `Se sincronizaron ${ok} formulario(s).`);
      } else if (ok > 0) {
        Alert.alert('Parcialmente sincronizado', `OK: ${ok}\nErrores: ${errores.length}\n\n${errores.slice(0, 3).join('\n')}${errores.length > 3 ? '\n…' : ''}`);
      } else {
        Alert.alert('Sincronización fallida', errores.slice(0, 5).join('\n'));
      }
    } catch (err) {
      console.error('❌ Error general al sincronizar:', err?.message || err);
      Alert.alert('Error', 'No se pudieron sincronizar los formularios.');
    } finally {
      contarFormulariosLocales();
      syncingRef.current = false;
    }
  };

  const cerrarSesion = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('⚠️ Error cerrando sesión:', e.message);
    }
    await AsyncStorage.removeItem('usuario_autenticado_local');
    setUsuario(null);
  };

  const handleLogin = async (user) => {
    setUsuario(user);
    contarFormulariosLocales();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!usuario) return <AuthScreen onLogin={handleLogin} />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.bienvenida}>
          Hola, {usuario.nombre?.split(' ')[0] || 'Usuario'}
        </Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity onPress={() => setVerActivaciones(v => !v)}>
            <Text style={styles.link}>
              {verActivaciones ? '📝 Volver al Formulario' : '📋 Ver Activaciones'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={cerrarSesion}>
            <Text style={styles.logout}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>
      </View>

      {verActivaciones ? (
        <FormulariosPorImpulsador usuario={usuario} />
      ) : (
        <FormularioActivacion
          cantidadOffline={cantidadOffline}
          contarFormulariosLocales={contarFormulariosLocales}
          onSincronizar={sincronizarFormularios}
          usuario={usuario}
        />
      )}
    </View>
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
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.inputBorder,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
  },
  bienvenida: {
    fontSize: fontSizes.medium,
    color: colors.text,
    fontWeight: '600',
  },
  link: {
    color: colors.primary,
    fontSize: fontSizes.small,
    fontWeight: '600',
    marginLeft: spacing.md,
  },
  logout: {
    color: colors.danger,
    fontSize: fontSizes.small,
    fontWeight: '600',
    marginLeft: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
