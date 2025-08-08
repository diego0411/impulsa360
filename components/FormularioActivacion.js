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

/** TIPOS en el ORDEN solicitado, con metadatos para derivar lógicas */
const TIPOS_ACTIVACION = [
  { key: 'comercio',                        label: 'Comercio',                             base: 'comercio',      reactivacion: false },
  { key: 'reactivacion_comercio',           label: 'Reactivación de comercio',             base: 'comercio',      reactivacion: true  },
  { key: 'tiendas_barrio',                  label: 'Tiendas de barrio',                    base: 'tienda_barrio', reactivacion: false },
  { key: 'reactivacion_tiendas_barrio',     label: 'Reactivación de tiendas de barrio',    base: 'tienda_barrio', reactivacion: true  },
  { key: 'transeuntes',                     label: 'Transeúntes',                          base: 'transeuntes',   reactivacion: false },
  { key: 'reactivacion_transeuntes',        label: 'Reactivación transeúntes',             base: 'transeuntes',   reactivacion: true  },
  { key: 'config_cuenta_limbo',             label: 'Configuración de cuenta (limbo)',      base: 'limbo',         reactivacion: false },
  { key: 'no_habilitado',                   label: 'No habilitado',                        base: 'none',          reactivacion: false },
];

const formularioInicial = {
  nombres_cliente: '', apellidos_cliente: '', ci_cliente: '',
  telefono_cliente: '', email_cliente: '',
  descargo_app: false, registro: false, cash_in: false, cash_out: false,
  p2p: false, qr_fisico: false,
  hubo_error: false, descripcion_error: '',
  /** Guardamos el KEY del tipo de activación (no el label) */
  tipo_activacion: '',
  tamano_tienda: '', tipo_comercio: '',
  foto_url: '',
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

  /** Helpers derivados del tipo seleccionado */
  const tipoActual = TIPOS_ACTIVACION.find(t => t.key === formulario.tipo_activacion) || null;
  const esReactivacion = !!tipoActual?.reactivacion;
  const base = tipoActual?.base || null;

  const esComercio = base === 'comercio' && !esReactivacion;
  const esReactivacionComercio = base === 'comercio' && esReactivacion;

  const esTiendaBarrio = base === 'tienda_barrio' && !esReactivacion;
  const esReactivacionTiendaBarrio = base === 'tienda_barrio' && esReactivacion;

  const esTranseuntes = base === 'transeuntes' && !esReactivacion;
  const esReactivacionTranseuntes = base === 'transeuntes' && esReactivacion;

  const esNoHabilitado = tipoActual?.key === 'no_habilitado';
  const esLimbo = tipoActual?.key === 'config_cuenta_limbo';

  const tiposComercio = ['Comercio', 'Hogar y Muebles', 'Transporte y Servicio', 'Cuidado Personal y Belleza', 'Educación y Entretenimiento', 'Consumo'];
  const tamanosTienda = ['Grande (Almacén)', 'Mediana (Sobre avenida)', 'Pequeña (En una calle)'];

  /** Limpieza automática al cambiar de tipo */
  const onTipoActivacionChange = (key) => {
    const nuevo = TIPOS_ACTIVACION.find(t => t.key === key);
    const newBase = nuevo?.base || null;

    setFormulario(prev => {
      const prevTipo = TIPOS_ACTIVACION.find(t => t.key === prev.tipo_activacion);
      const prevBase = prevTipo?.base || null;
      const cambiaDeGrupo = newBase !== prevBase;

      // reset comunes si es "no_habilitado"
      const resetIfNoHabilitado = key === 'no_habilitado'
        ? {
            descargo_app: false,
            registro: false,
            cash_in: false,
            cash_out: false,
            qr_fisico: false,
            p2p: false,
          }
        : {};

      return {
        ...prev,
        tipo_activacion: key,

        // Limpia campos dependientes si cambias de grupo
        tipo_comercio: (newBase === 'comercio' && prevBase === 'comercio') ? prev.tipo_comercio : '',
        tamano_tienda: (newBase === 'tienda_barrio' && prevBase === 'tienda_barrio') ? prev.tamano_tienda : '',

        // Si el nuevo tipo oculta QR, apágalo
        qr_fisico: (key === 'reactivacion_transeuntes' || key === 'no_habilitado') ? false : (resetIfNoHabilitado.qr_fisico ?? prev.qr_fisico),

        // Limpia foto si cambias de grupo (evita datos colgados)
        foto_url: cambiaDeGrupo ? '' : prev.foto_url,
        ...resetIfNoHabilitado,
      };
    });

    // si cambiamos de grupo, limpia también la miniatura local
    const prevBase = (TIPOS_ACTIVACION.find(t => t.key === formulario.tipo_activacion)?.base) || null;
    if ((nuevo?.base || null) !== prevBase) {
      setFotoUri(null);
    }
  };

  const tomarFotoYSubirImagen = async () => {
    try {
      const camPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (camPerm.status !== 'granted') {
        return Alert.alert('Permiso denegado', 'Se requiere permiso para acceder a la cámara.');
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
        allowsEditing: true
      });

      if (result.canceled) return;

      const uri = result.assets?.[0]?.uri;
      if (!uri || !uri.startsWith('file://')) {
        return Alert.alert('Error', 'La ruta de imagen no es válida');
      }

      let sizeMB = 0;
      try {
        const info = await FileSystem.getInfoAsync(uri, { size: true });
        sizeMB = info?.size ? Number(info.size) / 1024 / 1024 : 0;
      } catch {
        // en Android a veces no viene size; seguimos
      }

      if (sizeMB > 3) {
        return Alert.alert('❌ Imagen demasiado grande', 'Por favor, intenta tomar una foto más liviana (≤ 3 MB).');
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
      Alert.alert('Error crítico', `No se pudo procesar la imagen. ${error?.message || ''}`);
    }
  };

  const validar = () => {
    if (!formulario.nombres_cliente.trim()) return 'Ingresa los nombres del cliente.';
    if (!formulario.apellidos_cliente.trim()) return 'Ingresa los apellidos del cliente.';
    if (!/^\d{7,9}$/.test(formulario.ci_cliente)) return 'La cédula debe tener 7 a 9 números.';
    if (!/^\d{8}$/.test(formulario.telefono_cliente)) return 'El teléfono debe tener exactamente 8 números.';
    if (!formulario.tipo_activacion) return 'Selecciona el tipo de activación.';

    // Validación suave de email si viene algo escrito
    if (formulario.email_cliente && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formulario.email_cliente)) {
      return 'El correo no parece válido.';
    }

    // Reglas de foto: comercio/tienda/limbo/no_habilitado requieren foto
    const requiereFoto = ['comercio', 'tienda_barrio', 'config_cuenta_limbo', 'no_habilitado'].includes(tipoActual?.key || '');
    const hayFoto = formulario.foto_url || fotoUri;
    if (requiereFoto && !hayFoto) return 'Debes tomar una foto para este tipo de activación.';

    // Reglas específicas por base
    if ((esComercio || esReactivacionComercio) && !formulario.tipo_comercio) {
      return 'Selecciona el tipo de comercio.';
    }
    if ((esTiendaBarrio || esReactivacionTiendaBarrio) && !formulario.tamano_tienda) {
      return 'Selecciona el tamaño de la tienda.';
    }

    return null;
  };

  const guardarFormulario = async () => {
    const errorMsg = validar();
    if (errorMsg) return Alert.alert('Campo requerido', errorMsg);

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
        // guardar también el label para reportes
        tipo_activacion_label: tipoActual?.label || '',
        es_reactivacion: esReactivacion,
        base_activacion: base, // 'comercio' | 'tienda_barrio' | 'transeuntes' | 'limbo' | 'none'
        fecha_activacion: new Date().toISOString().split('T')[0],
        latitud,
        longitud,
        usuario_id: usuario.id,
        impulsador: usuario.nombre || 'Desconocido',
        plaza: usuario.plaza || null,
        foto_url: formulario.foto_url || fotoUri || null,
      };

      await guardarFormularioLocal(datosFormulario);
      Alert.alert('Guardado local', 'Formulario guardado localmente.');
      contarFormulariosLocales?.();

      // reset
      setFormulario(formularioInicial);
      setFotoUri(null);
    } catch (err) {
      console.error('Error al guardar formulario:', err);
      Alert.alert('Error', `No se pudo guardar el formulario. ${err?.message || ''}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.titulo}>Formulario de Activación</Text>
      <Text style={styles.subtitulo}>Guardados localmente: {cantidadOffline}</Text>

      {/* Tipo de Activación (usa KEY) */}
      <Text style={styles.label}>Tipo de Activación</Text>
      <Picker
        selectedValue={formulario.tipo_activacion}
        onValueChange={onTipoActivacionChange}
        style={styles.picker}
      >
        <Picker.Item label="Seleccionar..." value="" />
        {TIPOS_ACTIVACION.map((t) => (
          <Picker.Item key={t.key} label={t.label} value={t.key} />
        ))}
      </Picker>

      {/* Comercio (y su reactivación): tipo_comercio + imagen */}
      {(esComercio || esReactivacionComercio) && (
        <>
          <Text style={styles.label}>Tipo de Comercio</Text>
          <Image source={require('../assets/comercio.png')} style={styles.imagenComercio} resizeMode="cover" />
          <Picker
            selectedValue={formulario.tipo_comercio}
            onValueChange={(v) => actualizarCampo('tipo_comercio', v)}
            style={styles.picker}
          >
            <Picker.Item label="Seleccionar..." value="" />
            {tiposComercio.map((tipo, i) => <Picker.Item key={i} label={tipo} value={tipo} />)}
          </Picker>
        </>
      )}

      {/* Tiendas de barrio (y su reactivación): tamaño */}
      {(esTiendaBarrio || esReactivacionTiendaBarrio) && (
        <>
          <Text style={styles.label}>Tamaño de Tienda</Text>
          <Picker
            selectedValue={formulario.tamano_tienda}
            onValueChange={(v) => actualizarCampo('tamano_tienda', v)}
            style={styles.picker}
          >
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
      <TextInput style={styles.input} keyboardType="numeric" maxLength={9} value={formulario.ci_cliente} onChangeText={(v) => actualizarCampo('ci_cliente', v)} />

      <Text style={styles.label}>Teléfono</Text>
      <TextInput style={styles.input} keyboardType="numeric" maxLength={8} value={formulario.telefono_cliente} onChangeText={(v) => actualizarCampo('telefono_cliente', v)} />

      <Text style={styles.label}>Correo Electrónico</Text>
      <TextInput style={styles.input} keyboardType="email-address" autoCapitalize="none" value={formulario.email_cliente} onChangeText={(v) => actualizarCampo('email_cliente', v)} />

      {/* Switches generales (ocultos si es No habilitado) */}
      {!esNoHabilitado && (
        <>
          {['descargo_app', 'registro', 'cash_in', 'cash_out'].map(key => (
            <View key={key} style={styles.switchRow}>
              <Text style={styles.label}>{key.replace(/_/g, ' ').toUpperCase()}</Text>
              <Switch
                value={formulario[key]}
                onValueChange={(v) => actualizarCampo(key, v)}
                trackColor={{ false: colors.inputBorder, true: colors.primary }}
              />
            </View>
          ))}
        </>
      )}

      {/* QR físico: oculto solo en reactivación de transeúntes y en No habilitado */}
      {!esNoHabilitado && !esReactivacionTranseuntes && (
        <View style={styles.switchRow}>
          <Text style={styles.label}>QR FÍSICO</Text>
          <Switch
            value={formulario.qr_fisico}
            onValueChange={(v) => actualizarCampo('qr_fisico', v)}
            trackColor={{ false: colors.inputBorder, true: colors.primary }}
          />
        </View>
      )}

      {/* P2P (siempre visible) */}
      <View style={styles.switchRow}>
        <Text style={styles.label}>P2P</Text>
        <Switch
          value={formulario.p2p}
          onValueChange={(v) => actualizarCampo('p2p', v)}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
        />
      </View>

      {/* Errores */}
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

      {/* Foto */}
      <Text style={styles.label}>📷 Imagen</Text>
      <TouchableOpacity onPress={tomarFotoYSubirImagen} style={[styles.botonMini, { backgroundColor: colors.primary }]}>
        <Text style={styles.botonTextoMini}>📷 Tomar Foto</Text>
      </TouchableOpacity>
      {fotoUri && <Image source={{ uri: fotoUri }} style={styles.imagenMiniatura} />}

      {/* Botones */}
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
