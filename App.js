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
import { supabase } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
import SeleccionarPlaza from './components/SeleccionarPlaza';
import FormularioActivacion from './components/FormularioActivacion';
import {
  obtenerFormulariosLocales,
  eliminarFormularioLocal,
} from './lib/storage';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, fontSizes } from './styles/theme';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cantidadOffline, setCantidadOffline] = useState(0);
  const [plazaSeleccionada, setPlazaSeleccionada] = useState(null);

  useEffect(() => {
    verificarSesion();
  }, []);

  const verificarSesion = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error || !user) {
        setUsuario(null);
      } else {
        setUsuario(user);
      }
    } catch (e) {
      console.log('Error al verificar sesión:', e.message);
      setUsuario(null);
    } finally {
      setLoading(false);
    }
  };

  const contarFormulariosLocales = async () => {
    const datos = await obtenerFormulariosLocales();
    setCantidadOffline(datos.length);
  };

  const sincronizarFormularios = async () => {
    const state = await NetInfo.fetch();
    if (!state.isConnected) {
      Alert.alert('Sin conexión', 'Conéctate a internet para sincronizar.');
      return;
    }

    const formularios = await obtenerFormulariosLocales();
    for (let f of formularios) {
      const { id, ...formulario } = f;
      if (!formulario.fecha_activacion)
        formulario.fecha_activacion = new Date().toISOString().split('T')[0];
      delete formulario.fecha_hora;

      const datosConUsuario = { ...formulario, usuario_id: usuario.id };

      const { error } = await supabase
        .from('activaciones')
        .insert([datosConUsuario]);

      if (!error) await eliminarFormularioLocal(id);
      else console.log('Error al sincronizar:', error.message);
    }

    contarFormulariosLocales();
    Alert.alert('Sincronización completa', 'Todos los formularios fueron sincronizados.');
  };

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    await AsyncStorage.removeItem('session');
    setUsuario(null);
    setPlazaSeleccionada(null); // Reinicia la plaza al cerrar sesión
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!usuario) {
    return <AuthScreen onLogin={setUsuario} />;
  }

  if (!plazaSeleccionada) {
    return <SeleccionarPlaza onSeleccionar={setPlazaSeleccionada} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.bienvenida}>Hola, {usuario.email}</Text>
        <TouchableOpacity onPress={cerrarSesion}>
          <Text style={styles.logout}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>

      <FormularioActivacion
        cantidadOffline={cantidadOffline}
        contarFormulariosLocales={contarFormulariosLocales}
        onSincronizar={sincronizarFormularios}
        usuario={usuario}
        plaza={plazaSeleccionada} // ✅ Aquí se pasa la plaza seleccionada
      />
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
    backgroundColor: colors.inputBackground,
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
  },
});
