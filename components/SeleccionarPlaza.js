import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { colors, spacing, fontSizes, radius, shadow } from '../styles/theme';

export default function SeleccionarPlaza({ onSeleccionar }) {
  const [plaza, setPlaza] = useState('');

  const continuar = () => {
    if (!plaza) {
      Alert.alert('Selecciona una plaza', 'Debes elegir una plaza antes de continuar.');
      return;
    }

    // Por ahora, solo mostramos una alerta. Más adelante se puede navegar o mostrar otro formulario.
    Alert.alert('Plaza seleccionada', `Has seleccionado: ${plaza}`);
    onSeleccionar(plaza); // Para manejar la navegación/formulario más adelante
  };

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Selecciona tu plaza</Text>

      <Picker
        selectedValue={plaza}
        onValueChange={(value) => setPlaza(value)}
        style={styles.picker}
      >
        <Picker.Item label="Seleccionar plaza..." value="" />
        <Picker.Item label="Santa Cruz" value="santa_cruz" />
        <Picker.Item label="Potosí" value="potosi" />
        <Picker.Item label="Cochabamba" value="cochabamba" />
      </Picker>

      <TouchableOpacity onPress={continuar} style={styles.boton}>
        <Text style={styles.botonTexto}>Continuar</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
  titulo: {
    fontSize: fontSizes.xlarge,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  picker: {
    backgroundColor: colors.inputBackground,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  boton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    ...shadow.base,
  },
  botonTexto: {
    textAlign: 'center',
    color: '#fff',
    fontSize: fontSizes.medium,
    fontWeight: '600',
  },
});
