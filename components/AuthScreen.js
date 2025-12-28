import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

export default function AuthScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  
  // forzamos siempre inicio de sesión
  const esRegistro = false;

  const manejarAutenticacion = async () => {
    const netState = await NetInfo.fetch();

    if (!netState.isConnected) {
      Alert.alert('Sin conexión', 'Necesitas conexión a internet para autenticarte.');
      return;
    }

    if (!email || !password || (esRegistro && !nombre)) {
      Alert.alert('Error', 'Completa todos los campos');
      return;
    }

    try {
      if (esRegistro) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { nombre } },
        });

        if (error) {
          Alert.alert('Error', error.message);
          return;
        }

        const user = data.user;
        if (user) {
          await supabase.from('activadores').upsert({
            usuario_id: user.id,
            nombre,
          });
          Alert.alert('✅ Registro exitoso', 'Ahora inicia sesión');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          Alert.alert('Error', error.message);
        } else {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();

          if (sessionError) {
            Alert.alert('Error', sessionError.message);
            return;
          }

          const usuario = session?.user || data.user;

          const { data: perfil, error: errorPerfil } = await supabase
            .from('activadores')
            .select('*')
            .eq('usuario_id', usuario.id)
            .single();

          if (errorPerfil) {
            console.warn('No se pudo obtener el perfil del impulsador:', errorPerfil.message);
          }

          const usuarioFinal = {
            id: usuario.id,
            email: usuario.email,
            nombre: (perfil?.nombre || usuario.user_metadata?.nombre || usuario.email || '').trim(),
            plaza: (perfil?.plaza || '').trim() || 'No especificada',
          };

          await AsyncStorage.setItem('usuario_autenticado_local', JSON.stringify(usuarioFinal));
          onLogin(usuarioFinal);
        }
      }
    } catch (err) {
      Alert.alert('Error crítico', err.message || 'Ocurrió un error inesperado');
      console.error('Error en autenticación:', err);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Inicio de Sesión</Text>

      {/* no mostramos campo de nombre porque registro está desactivado */}
      {/* no mostramos botón de alternar a registro */}

      <TextInput
        style={styles.input}
        placeholder="Correo electrónico"
        placeholderTextColor={colors.muted}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        placeholderTextColor={colors.muted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity onPress={manejarAutenticacion} style={styles.boton}>
        <Text style={styles.botonTexto}>Iniciar Sesión</Text>
      </TouchableOpacity>

      {/* se elimina la opción de alternar registro */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  titulo: {
    fontSize: fontSizes.xlarge,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSizes.medium,
    color: colors.text,
    marginBottom: spacing.md,
  },
  boton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  botonTexto: {
    color: '#fff',
    fontSize: fontSizes.medium,
    fontWeight: '600',
  },
});
