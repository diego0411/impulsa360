import React, { useEffect, useState } from 'react';
import {
  View,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Alert,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { supabase } from './lib/supabase';
import { colors, spacing, fontSizes } from './styles/theme';
import AuthScreen from './components/AuthScreen';
import FormularioActivacion from './components/FormularioActivacion';
import FormulariosPorImpulsador from './components/FormulariosPorImpulsador';
import { obtenerFormulariosLocales, eliminarFormularioLocal } from './lib/storage';
import { subirImagenASupabase } from './lib/upload';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cantidadOffline, setCantidadOffline] = useState(0);
  const [isConnected, setIsConnected] = useState(null);
  const [verActivaciones, setVerActivaciones] = useState(false);

  // Detectar cambios de conexión
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
    });
    return unsubscribe;
  }, []);

  // Verificar sesión una vez detectado el estado de conexión
  useEffect(() => {
    if (isConnected !== null) verificarSesion();
  }, [isConnected]);

  const verificarSesion = async () => {
    setLoading(true);
    try {
      if (!isConnected) {
        const storedUser = await AsyncStorage.getItem('usuario_autenticado_local');
        if (storedUser) {
          console.debug('📦 Usuario offline cargado:', storedUser);
          setUsuario(JSON.parse(storedUser));
        } else {
          console.warn('⚠️ No se encontró usuario local.');
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
      console.error('❌ Error verificando sesión:', e.message || e);
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
    if (!isConnected) {
      Alert.alert('Sin conexión', 'Conéctate a internet para sincronizar.');
      return;
    }

    try {
      const formularios = await obtenerFormulariosLocales();
      for (const f of formularios) {
        const { id, ...formulario } = f;

        formulario.fecha_activacion ??= new Date().toISOString().split('T')[0];
        delete formulario.fecha_hora;

        if (formulario.foto_url?.startsWith('file://')) {
          console.debug(`📷 Subiendo imagen del formulario ${id}`);
          const url = await subirImagenASupabase(formulario.foto_url);
          if (url) formulario.foto_url = url;
        }

        const datosConUsuario = {
          ...formulario,
          usuario_id: usuario?.id,
          impulsador: usuario?.nombre,
          plaza: usuario?.plaza,
        };

        const { error } = await supabase.from('activaciones').insert([datosConUsuario]);

        if (!error) {
          await eliminarFormularioLocal(id);
          console.debug(`✅ Formulario ${id} sincronizado.`);
        } else {
          console.error(`❌ Error en formulario ${id}:`, error.message);
        }
      }

      contarFormulariosLocales();
      Alert.alert('Sincronización completa', 'Todos los formularios fueron sincronizados.');
    } catch (err) {
      console.error('❌ Error general al sincronizar:', err.message || err);
      Alert.alert('Error', 'No se pudieron sincronizar los formularios.');
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
        <Text style={styles.bienvenida}>Hola, {usuario.nombre?.split(' ')[0] || 'Usuario'}</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity onPress={() => setVerActivaciones(v => !v)}>
            <Text style={styles.logout}>
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
