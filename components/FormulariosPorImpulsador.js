import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, fontSizes } from '../styles/theme';

export default function FormulariosPorImpulsador({ usuario }) {
  const [formularios, setFormularios] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    obtenerFormularios();
  }, []);

  const obtenerFormularios = async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from('activaciones')
      .select('*')
      .eq('usuario_id', usuario.id) // ⚠️ Aquí filtramos por usuario logueado
      .order('fecha_activacion', { ascending: false });

    if (error) {
      console.error('❌ Error al obtener formularios:', error.message);
      setFormularios([]);
    } else {
      setFormularios(data || []);
    }

    setCargando(false);
  };

  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <Text style={styles.label}>📍 {item.lugar_activacion}</Text>
      <Text style={styles.text}>📅 {item.fecha_activacion}</Text>
      <Text style={styles.text}>🧍 Cliente: {item.nombres_cliente} {item.apellidos_cliente}</Text>
      <Text style={styles.text}>📦 Tipo: {item.tipo_activacion}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>📋 Mis Formularios Enviados</Text>
      {cargando ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : formularios.length === 0 ? (
        <Text style={styles.text}>No hay formularios registrados.</Text>
      ) : (
        <FlatList
          data={formularios}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  titulo: {
    fontSize: fontSizes.large,
    fontWeight: 'bold',
    marginBottom: spacing.md,
    color: colors.primary,
  },
  item: {
    backgroundColor: colors.inputBackground,
    padding: spacing.md,
    borderRadius: 10,
    marginBottom: spacing.md,
    borderColor: colors.inputBorder,
    borderWidth: 1,
  },
  label: {
    fontWeight: 'bold',
    color: colors.text,
    fontSize: fontSizes.medium,
    marginBottom: 4,
  },
  text: {
    color: colors.text,
    fontSize: fontSizes.small,
  },
});
