import React, { useState } from 'react';
import {
  View, Text, TextInput, Alert, ScrollView, Switch, StyleSheet,
  TouchableOpacity, Image, Dimensions
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { guardarFormularioLocal } from '../lib/storage';
import { subirImagenASupabase } from '../lib/upload';
import { colors, spacing, fontSizes, radius, shadow } from '../styles/theme';

const screenWidth = Dimensions.get('window').width;

const formularioInicial = {
  nombres_cliente: '', apellidos_cliente: '', ci_cliente: '',
  telefono_cliente: '', email_cliente: '', descargo_app: false, registro: false,
  cash_in: false, cash_out: false, p2p: false, qr_fisico: false,
  hubo_error: false, descripcion_error: '', tipo_activacion: '',
  tamano_tienda: '', tipo_comercio: '', foto_url: '',
  reactivacion_comercio: false,
};

export default function FormularioActivacion({ cantidadOffline, contarFormulariosLocales, onSincronizar, usuario }) {
  const [formulario, setFormulario] = useState(formularioInicial);
  const [fotoUri, setFotoUri] = useState(null);

  if (!usuario || !usuario.id) {
    return <Text style={{ padding: 20, color: colors.text }}>Cargando usuario...</Text>;
  }

  const actualizarCampo = (campo, valor) => {
    setFormulario(prev => ({ ...prev, [campo]: valor }));
  };

  const tomarFotoYSubirImagen = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        return Alert.alert('Permiso denegado', 'Se requiere permiso para acceder a la cámara.');
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.4,
        allowsEditing: true
      });

      if (result.canceled) return;

      const uri = result.assets?.[0]?.uri;
      if (!uri || !uri.startsWith('file://')) {
        return Alert.alert('Error', 'La ruta de imagen no es válida');
      }

      const info = await FileSystem.getInfoAsync(uri);
      const sizeMB = (info.size / 1024 / 1024).toFixed(2);

      if (sizeMB > 2) {
        return Alert.alert('❌ Imagen demasiado grande', 'Por favor, intenta tomar una foto más liviana.');
      }

      setFotoUri(uri);
      actualizarCampo('foto_url', uri);

      const url = await subirImagenASupabase(uri);
      if (url) {
        actualizarCampo('foto_url', url);
        Alert.alert('✅ Imagen subida correctamente');
      } else {
        console.warn('⚠️ No se pudo subir la imagen ahora. Se usará URI local para sincronizar luego.');
      }
    } catch (error) {
      console.error('❌ Error al tomar o subir imagen:', error);
      Alert.alert('Error crítico', `No se pudo procesar la imagen. ${error.message || ''}`);
    }
  };
  const tiposActivacion = [
    'Comercio', 'Transeúnte', 'Configuración de Cuenta',
    'Tienda de Barrio', 'No Habilitado', 'Reactivación de Transeúntes'
  ];

  const tiposComercio = ['Comercio', 'Hogar y Muebles', 'Transporte y Servico', 'Cuidado Personal y Belleza', 'Educación y Entretenimiento', 'Consumo'];
  const tamanosTienda = ['Grande (Almacén)', 'Mediana (Sobre avenida)', 'Pequeña (En una calle)'];

  const esComercio = formulario.tipo_activacion === 'Comercio';
  const esTiendaBarrio = formulario.tipo_activacion === 'Tienda de Barrio';
  const esNoHabilitado = formulario.tipo_activacion === 'No Habilitado';
  const esReactivacionTrans = formulario.tipo_activacion === 'Reactivación de Transeúntes';

  const guardarFormulario = async () => {
    if (!formulario.nombres_cliente.trim()) return Alert.alert('Campo requerido', 'Ingresa los nombres del cliente.');
    if (!formulario.apellidos_cliente.trim()) return Alert.alert('Campo requerido', 'Ingresa los apellidos del cliente.');
    if (!/^\d{7,8}$/.test(formulario.ci_cliente)) return Alert.alert('Campo inválido', 'La cédula debe tener 7 u 8 números.');
    if (!/^\d{8}$/.test(formulario.telefono_cliente)) return Alert.alert('Campo inválido', 'El teléfono debe tener exactamente 8 números.');
    if (!formulario.tipo_activacion) return Alert.alert('Campo requerido', 'Selecciona el tipo de activación.');

    const tiposRequierenFoto = ['Comercio', 'Configuración de Cuenta', 'Tienda de Barrio', 'No Habilitado'];
    const requiereFoto = tiposRequierenFoto.includes(formulario.tipo_activacion);
    const hayFoto = formulario.foto_url || fotoUri;

    if (requiereFoto && !hayFoto) {
      return Alert.alert('Campo requerido', 'Debes tomar una foto para este tipo de activación.');
    }

    try {
      let latitud = null, longitud = null;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const ubicacion = await Location.getCurrentPositionAsync({});
        latitud = ubicacion.coords.latitude;
        longitud = ubicacion.coords.longitude;
      }

      const datosFormulario = {
        ...formulario,
        fecha_activacion: new Date().toISOString().split('T')[0],
        latitud,
        longitud,
        usuario_id: usuario.id,
        impulsador: usuario.nombre || 'Desconocido',
        plaza: usuario.plaza || null,
        foto_url: formulario.foto_url || fotoUri || null
      };

      await guardarFormularioLocal(datosFormulario);
      Alert.alert('Guardado local', 'Formulario guardado localmente.');
      contarFormulariosLocales();
      setFormulario(formularioInicial);
      setFotoUri(null);
    } catch (err) {
      console.error('Error al guardar formulario:', err);
      Alert.alert('Error', `No se pudo guardar el formulario. ${err.message || ''}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.titulo}>Formulario de Activación</Text>
      <Text style={styles.subtitulo}>Guardados localmente: {cantidadOffline}</Text>

      <Text style={styles.label}>Tipo de Activación</Text>
      <Picker selectedValue={formulario.tipo_activacion} onValueChange={(v) => actualizarCampo('tipo_activacion', v)} style={styles.picker}>
        <Picker.Item label="Seleccionar..." value="" />
        {tiposActivacion.map((tipo, i) => <Picker.Item key={i} label={tipo} value={tipo} />)}
      </Picker>

      {esComercio && (
        <>
          <Text style={styles.label}>Tipo de Comercio</Text>
          <Image source={require('../assets/comercio.png')} style={styles.imagenComercio} resizeMode="cover" />
          <Picker selectedValue={formulario.tipo_comercio} onValueChange={(v) => actualizarCampo('tipo_comercio', v)} style={styles.picker}>
            <Picker.Item label="Seleccionar..." value="" />
            {tiposComercio.map((tipo, i) => <Picker.Item key={i} label={tipo} value={tipo} />)}
          </Picker>
        </>
      )}

      {esTiendaBarrio && (
        <>
          <Text style={styles.label}>Tamaño de Tienda</Text>
          <Picker selectedValue={formulario.tamano_tienda} onValueChange={(v) => actualizarCampo('tamano_tienda', v)} style={styles.picker}>
            <Picker.Item label="Seleccionar..." value="" />
            {tamanosTienda.map((tam, i) => <Picker.Item key={i} label={tam} value={tam} />)}
          </Picker>
        </>
      )}

      {/* Inputs comunes */}
      <Text style={styles.label}>Nombres del Cliente</Text>
      <TextInput style={styles.input} value={formulario.nombres_cliente} onChangeText={(v) => actualizarCampo('nombres_cliente', v)} />

      <Text style={styles.label}>Apellidos</Text>
      <TextInput style={styles.input} value={formulario.apellidos_cliente} onChangeText={(v) => actualizarCampo('apellidos_cliente', v)} />

      <Text style={styles.label}>Cédula de Identidad</Text>
      <TextInput style={styles.input} keyboardType="numeric" maxLength={8} value={formulario.ci_cliente} onChangeText={(v) => actualizarCampo('ci_cliente', v)} />

      <Text style={styles.label}>Teléfono</Text>
      <TextInput style={styles.input} keyboardType="numeric" maxLength={8} value={formulario.telefono_cliente} onChangeText={(v) => actualizarCampo('telefono_cliente', v)} />

      <Text style={styles.label}>Correo Electrónico</Text>
      <TextInput style={styles.input} keyboardType="email-address" autoCapitalize="none" value={formulario.email_cliente} onChangeText={(v) => actualizarCampo('email_cliente', v)} />

      {esTiendaBarrio && (
        <View style={styles.switchRow}>
          <Text style={styles.label}>REACTIVACIÓN COMERCIO</Text>
          <Switch
            value={formulario.reactivacion_comercio}
            onValueChange={(v) => actualizarCampo('reactivacion_comercio', v)}
            trackColor={{ false: colors.inputBorder, true: colors.primary }}
          />
        </View>
      )}
      {['descargo_app', 'registro', 'cash_in', 'cash_out'].map(key => {
        if (esNoHabilitado) return null;
        return (
          <View key={key} style={styles.switchRow}>
            <Text style={styles.label}>{key.replace(/_/g, ' ').toUpperCase()}</Text>
            <Switch
              value={formulario[key]}
              onValueChange={(v) => actualizarCampo(key, v)}
              trackColor={{ false: colors.inputBorder, true: colors.primary }}
            />
          </View>
        );
      })}

      {!esNoHabilitado && !esReactivacionTrans && (
        <View style={styles.switchRow}>
          <Text style={styles.label}>QR FÍSICO</Text>
          <Switch
            value={formulario.qr_fisico}
            onValueChange={(v) => actualizarCampo('qr_fisico', v)}
            trackColor={{ false: colors.inputBorder, true: colors.primary }}
          />
        </View>
      )}

      <View style={styles.switchRow}>
        <Text style={styles.label}>P2P</Text>
        <Switch
          value={formulario.p2p}
          onValueChange={(v) => actualizarCampo('p2p', v)}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
        />
      </View>

      <Text style={styles.label}>¿Hubo error?</Text>
      <Switch
        value={formulario.hubo_error}
        onValueChange={(v) => actualizarCampo('hubo_error', v)}
        trackColor={{ false: colors.inputBorder, true: colors.warning }}
      />
      {formulario.hubo_error && (
        <>
          <Text style={styles.label}>Descripción del error</Text>
          <TextInput value={formulario.descripcion_error} onChangeText={(v) => actualizarCampo('descripcion_error', v)} style={styles.input} />
        </>
      )}

      <Text style={styles.label}>📷 Imagen</Text>
      <TouchableOpacity onPress={tomarFotoYSubirImagen} style={[styles.botonMini, { backgroundColor: colors.primary }]}>
        <Text style={styles.botonTextoMini}>📷 Tomar Foto</Text>
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
  imagenComercio: {
    width: screenWidth - spacing.lg * 2,
    height: 200,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    alignSelf: 'center',
  },
});
