import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

export default function AuthScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [esRegistro, setEsRegistro] = useState(false);

  const manejarAutenticacion = async () => {
    if (!email || !password || (esRegistro && !nombre)) {
      Alert.alert('Error', 'Completa todos los campos');
      return;
    }

    if (esRegistro) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { nombre }, // guarda en user_metadata
        },
      });

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      const user = data.user;
      if (user) {
        // Guarda en tabla "activadores"
        await supabase.from('activadores').upsert({
          id: user.id,
          nombre,
        });
        Alert.alert('✅ Registro exitoso', 'Ahora inicia sesión');
        setEsRegistro(false); // Cambia a modo login
        setEmail('');
        setPassword('');
        setNombre('');
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        onLogin(data.user);
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>
        {esRegistro ? 'Registro de Usuario' : 'Inicio de Sesión'}
      </Text>

      {esRegistro && (
        <TextInput
          style={styles.input}
          placeholder="Nombre completo"
          placeholderTextColor={colors.muted}
          value={nombre}
          onChangeText={setNombre}
        />
      )}

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
        <Text style={styles.botonTexto}>
          {esRegistro ? 'Registrarse' : 'Iniciar Sesión'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setEsRegistro(!esRegistro)} style={{ marginTop: spacing.md }}>
        <Text style={{ color: colors.primary, textAlign: 'center' }}>
          {esRegistro ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
        </Text>
      </TouchableOpacity>
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