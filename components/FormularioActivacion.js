import React, { useState } from 'react';
import {
  View, Text, TextInput, Alert, ScrollView, Switch, StyleSheet,
  TouchableOpacity, Image
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { guardarFormularioLocal } from '../lib/storage';
import { subirImagenASupabase } from '../lib/upload';
import { colors, spacing, fontSizes, radius, shadow } from '../styles/theme';

export default function FormularioActivacion({
  cantidadOffline,
  contarFormulariosLocales,
  onSincronizar,
  usuario
}) {
  const [formulario, setFormulario] = useState({
    lugar_activacion: '', nombres_cliente: '', apellidos_cliente: '',
    ci_cliente: '', telefono_cliente: '', email_cliente: '', descargo_app: false, registro: false, cash_in: false,
    cash_out: false, p2p: false, qr_fisico: false, respaldo: false, hubo_error: false, descripcion_error: '',
    tipo_activacion: '', tamano_tienda: '', tipo_comercio: '', foto_url: ''
  });

  const [fotoUri, setFotoUri] = useState(null);

  const actualizarCampo = (campo, valor) => {
    setFormulario({ ...formulario, [campo]: valor });
  };

  const seleccionarYSubirImagen = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setFotoUri(uri);

      const url = await subirImagenASupabase(uri);
      if (url) {
        actualizarCampo('foto_url', url);
        Alert.alert('✅ Imagen subida correctamente');
      } else {
        Alert.alert('❌ Error al subir la imagen');
      }
    }
  };

  const guardarFormulario = async () => {
    try {
      let latitud = null, longitud = null;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const ubicacion = await Location.getCurrentPositionAsync({});
        latitud = ubicacion.coords.latitude;
        longitud = ubicacion.coords.longitude;
      }

      const fechaActual = new Date().toISOString().split('T')[0];

      const datosFormulario = {
        ...formulario,
        fecha_activacion: fechaActual,
        latitud,
        longitud,
        usuario_id: usuario.id
      };

      await guardarFormularioLocal(datosFormulario);
      Alert.alert('Guardado local', 'Formulario guardado localmente.');
      contarFormulariosLocales();
      setFormulario({
        lugar_activacion: '', nombres_cliente: '', apellidos_cliente: '',
        ci_cliente: '', telefono_cliente: '', email_cliente: '', descargo_app: false, registro: false, cash_in: false,
        cash_out: false, p2p: false, qr_fisico: false, respaldo: false, hubo_error: false, descripcion_error: '',
        tipo_activacion: '', tamano_tienda: '', tipo_comercio: '', foto_url: ''
      });
      setFotoUri(null);
    } catch (err) {
      console.log('Error al guardar:', err);
      Alert.alert('Error', 'No se pudo guardar el formulario');
    }
  };

  const lugaresActivacion = ['Avenida Beni Mamore', 'Distrito 1', 'Distrito 2', 'Otros'];
  const tiposActivacion = ['Comercio', 'Transeúnte', 'Reactivación', 'Re Activación Comercio'];
  const tiposComercio = ['Tiendas de Barrio', 'Hogar y Muebles', 'Cuidado Personal'];
  const tamanosTienda = ['Pequeña', 'Mediana', 'Grande'];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.titulo}>Formulario de Activación</Text>
      <Text style={styles.subtitulo}>Guardados localmente: {cantidadOffline}</Text>

      <Text style={styles.label}>Lugar de Activación</Text>
      <Picker selectedValue={formulario.lugar_activacion} onValueChange={(v) => actualizarCampo('lugar_activacion', v)} style={styles.picker}>
        <Picker.Item label="Seleccionar..." value="" />
        {lugaresActivacion.map((lugar, i) => <Picker.Item key={i} label={lugar} value={lugar} />)}
      </Picker>

      {[['nombres_cliente', 'Nombres del Cliente'], ['apellidos_cliente', 'Apellidos'],
        ['ci_cliente', 'Cédula de Identidad'], ['telefono_cliente', 'Teléfono'],
        ['email_cliente', 'Correo Electrónico']].map(([campo, etiqueta]) => (
        <View key={campo}>
          <Text style={styles.label}>{etiqueta}</Text>
          <TextInput style={styles.input} value={formulario[campo]} onChangeText={(v) => actualizarCampo(campo, v)} />
        </View>
      ))}

      {['descargo_app', 'registro', 'cash_in', 'cash_out', 'p2p', 'qr_fisico', 'respaldo'].map(key => (
        <View key={key} style={styles.switchRow}>
          <Text style={styles.label}>{key.replace(/_/g, ' ').toUpperCase()}</Text>
          <Switch value={formulario[key]} onValueChange={(v) => actualizarCampo(key, v)} />
        </View>
      ))}

      <Text style={styles.label}>¿Hubo error?</Text>
      <Switch value={formulario.hubo_error} onValueChange={(v) => actualizarCampo('hubo_error', v)} />
      {formulario.hubo_error && (
        <>
          <Text style={styles.label}>Descripción del error</Text>
          <TextInput value={formulario.descripcion_error} onChangeText={(v) => actualizarCampo('descripcion_error', v)} style={styles.input} />
        </>
      )}

      <Text style={styles.label}>Tipo de Activación</Text>
      <Picker selectedValue={formulario.tipo_activacion} onValueChange={(v) => actualizarCampo('tipo_activacion', v)} style={styles.picker}>
        <Picker.Item label="Seleccionar..." value="" />
        {tiposActivacion.map((tipo, i) => <Picker.Item key={i} label={tipo} value={tipo} />)}
      </Picker>

      {(formulario.tipo_activacion === 'Comercio' || formulario.tipo_activacion === 'Re Activación Comercio') && (
        <>
          <Text style={styles.label}>Tipo de Comercio</Text>
          <Picker selectedValue={formulario.tipo_comercio} onValueChange={(v) => actualizarCampo('tipo_comercio', v)} style={styles.picker}>
            <Picker.Item label="Seleccionar..." value="" />
            {tiposComercio.map((tipo, i) => <Picker.Item key={i} label={tipo} value={tipo} />)}
          </Picker>
        </>
      )}

      <Text style={styles.label}>Tamaño de Tienda</Text>
      <Picker selectedValue={formulario.tamano_tienda} onValueChange={(v) => actualizarCampo('tamano_tienda', v)} style={styles.picker}>
        <Picker.Item label="Seleccionar..." value="" />
        {tamanosTienda.map((tam, i) => <Picker.Item key={i} label={tam} value={tam} />)}
      </Picker>

      <Text style={styles.label}>📷 Imagen del Comercio</Text>
      <TouchableOpacity onPress={seleccionarYSubirImagen} style={[styles.botonMini, { backgroundColor: colors.primary }]}>
        <Text style={styles.botonTextoMini}>Seleccionar Imagen</Text>
      </TouchableOpacity>

      {fotoUri && <Image source={{ uri: fotoUri }} style={styles.imagenMiniatura} />}

      <View style={styles.botonesRow}>
        <TouchableOpacity onPress={guardarFormulario} style={[styles.botonMini, { backgroundColor: colors.primary }]}>
          <Text style={styles.botonTextoMini}>💾 Guardar</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSincronizar} style={[styles.botonMini, { backgroundColor: colors.success }]}>
          <Text style={styles.botonTextoMini}>🔄 Sincronizar</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, marginTop: spacing.md, backgroundColor: colors.background },
  titulo: { fontSize: fontSizes.xlarge, fontWeight: '600', marginBottom: spacing.sm, color: colors.text, textAlign: 'center' },
  subtitulo: { fontSize: fontSizes.small, fontWeight: '500', textAlign: 'center', marginBottom: spacing.md, color: colors.muted },
  label: { fontSize: fontSizes.medium, marginTop: spacing.sm, marginBottom: spacing.xs, color: colors.text },
  input: { borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  picker: { backgroundColor: colors.inputBackground, borderRadius: radius.md, marginBottom: spacing.sm },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginVertical: spacing.xs, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.inputBorder
  },
  botonesRow: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    marginTop: spacing.lg, marginBottom: spacing.xl,
  },
  botonMini: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg,
    minWidth: 90,
    ...shadow.base,
  },
  botonTextoMini: { color: '#fff', fontSize: fontSizes.medium, fontWeight: '600', textAlign: 'center' },
  imagenMiniatura: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
});
