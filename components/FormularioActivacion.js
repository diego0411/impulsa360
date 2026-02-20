import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  ScrollView,
  Switch,
  StyleSheet,
  TouchableOpacity,
  Image,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import { guardarFormularioLocal } from '../lib/storage';
import { colors, spacing, fontSizes, radius, shadow } from '../styles/theme';

const DEVICE_INFO = `react-native-${Platform.OS}`;

const GRUPOS_ACTIVACION = [
  { key: 'tienda_barrio', label: 'Tiendas de Barrio' },
  { key: 'mercados', label: 'Mercados' },
];

const TIPOS_TIENDAS = [
  { key: 'comercio', label: 'Comercio' },
  { key: 'no_habilitado', label: 'No habilitado' },
  { key: 'reactivacion', label: 'Reactivación' },
  { key: 'config_cuenta', label: 'Configuración de cuenta' },
  { key: 'reimpresion_qr', label: 'Reimpresión QR' },
];

const TIPOS_MERCADOS = [
  { key: 'comercio', label: 'Comercio' },
  { key: 'reactivacion_comercio', label: 'Reactivación comercio' },
  { key: 'transeunte', label: 'Transeúnte' },
  { key: 'reactivacion_transeunte', label: 'Reactivación transeúnte' },
  { key: 'limbo', label: 'Limbo' },
  { key: 'no_habilitado', label: 'No habilitado' },
  { key: 'reimpresion_qr', label: 'Reimpresión QR' },
];

const TAMANOS_TIENDA = ['Pequeña', 'Mediana', 'Grande'];
const TIPOS_COMERCIO = ['Comercio', 'Hogar y Muebles', 'Transporte y Servicio', 'Cuidado Personal y Belleza', 'Educación y Entretenimiento', 'Consumo'];

const CIUDADES = [
  { key: 'santa_cruz', label: 'Santa Cruz', zonas: ['Centro', 'Equipetrol', 'Satelite Norte'] },
  { key: 'la_paz', label: 'La Paz', zonas: ['Centro', 'Sopocachi', 'Miraflores'] },
  { key: 'el_alto', label: 'El Alto', zonas: ['Ceja', 'Villa Adela', '16 de Julio'] },
  { key: 'cochabamba', label: 'Cochabamba', zonas: ['Centro', 'Sarco', 'Queru Queru'] },
];

const normalizarCiudad = (valor = '') =>
  String(valor)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');

const resolverCiudadKey = (valor = '') => {
  const normalized = normalizarCiudad(valor);
  if (!normalized) return '';
  const porKey = CIUDADES.find((c) => c.key === normalized);
  if (porKey) return porKey.key;
  const porLabel = CIUDADES.find((c) => normalizarCiudad(c.label) === normalized);
  return porLabel?.key || '';
};

const extraerExtension = (uri = '') => {
  const limpio = String(uri).split('?')[0].split('#')[0];
  const nombre = limpio.split('/').pop() || '';
  const ext = nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : '';
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg';
};

const formularioInicial = {
  tipo_grupo: '',
  tipo_activacion: '',
  id: '',
  tamano_tienda: '',
  ciudad_activacion: '',
  zona_activacion: '',
  impulsador: '',
  fecha_activacion: '',
  nombres_cliente: '',
  apellidos_cliente: '',
  ci_cliente: '',
  telefono_cliente: '',
  email_cliente: '',
  descargo_app: false,
  registro: false,
  cash_in: false,
  cash_out: false,
  p2p: false,
  qr_fisico: false,
  respaldo: false,
  hubo_error: false,
  descripcion_error: '',
  latitud: null,
  longitud: null,
  base_activacion: '',
  es_reactivacion: false,
  foto_respaldo_url: '',
  foto_url: '',
  estado_sync: 'offline_pending',
  dispositivo: DEVICE_INFO,
};

export default function FormularioActivacion({
  cantidadOffline,
  contarFormulariosLocales,
  onSincronizar,
  usuario,
}) {
  const [formulario, setFormulario] = useState(formularioInicial);
  const [fotoRespaldo, setFotoRespaldo] = useState(null);
  const [fotoPrincipal, setFotoPrincipal] = useState(null);
  const { width } = useWindowDimensions();
  const imagenComercioWidth = Math.max(200, Math.min(width - spacing.lg * 2, 720));
  const imagenComercioHeight = Math.round(imagenComercioWidth / (16 / 9));
  const botonShadow = Platform.OS === 'web'
    ? { boxShadow: '0px 2px 6px rgba(0,0,0,0.3)' }
    : shadow.base;

  const actualizarCampo = (campo, valor) => {
    setFormulario(prev => ({ ...prev, [campo]: valor }));
  };

  const tiposDisponibles = formulario.tipo_grupo === 'tienda_barrio' ? TIPOS_TIENDAS
    : formulario.tipo_grupo === 'mercados' ? TIPOS_MERCADOS
    : [];

  const ciudadSeleccionada = useMemo(
    () => CIUDADES.find(c => c.key === formulario.ciudad_activacion) || null,
    [formulario.ciudad_activacion],
  );
  const zonasDisponibles = ciudadSeleccionada?.zonas || [];

  const baseActivacionPreview = useMemo(() => {
    if (formulario.tipo_grupo === 'tienda_barrio') return 'tienda_barrio';
    switch (formulario.tipo_activacion) {
      case 'comercio':
      case 'reactivacion_comercio':
        return 'comercio';
      case 'transeunte':
      case 'reactivacion_transeunte':
        return 'transeunte';
      case 'limbo':
        return 'limbo';
      case 'no_habilitado':
      case 'reimpresion_qr':
      default:
        return 'none';
    }
  }, [formulario.tipo_grupo, formulario.tipo_activacion]);

  const requiereTipoComercio =
    (formulario.tipo_grupo === 'tienda_barrio' && ['comercio', 'reactivacion'].includes(formulario.tipo_activacion)) ||
    baseActivacionPreview === 'comercio';

  const requiereTamano = formulario.tipo_grupo === 'tienda_barrio'
    && ['comercio', 'reactivacion'].includes(formulario.tipo_activacion);

  const requiereFotos = formulario.tipo_activacion
    && !['transeunte', 'reactivacion_transeunte'].includes(formulario.tipo_activacion);

  const onGrupoChange = (grupo) => {
    setFormulario(prev => ({
      ...prev,
      tipo_grupo: grupo,
      tipo_activacion: '',
      tamano_tienda: '',
      tipo_comercio: '',
    }));
  };

  const onTipoActivacionChange = (key) => {
    setFormulario(prev => ({
      ...prev,
      tipo_activacion: key,
    }));
  };

  // Auto-set de datos provenientes del usuario y fecha actual
  useEffect(() => {
    const hoy = new Date().toISOString().split('T')[0];
    const ciudadUsuario = resolverCiudadKey(usuario?.plaza);
    setFormulario(prev => ({
      ...prev,
      fecha_activacion: prev.fecha_activacion || hoy,
      impulsador: prev.impulsador || usuario?.nombre || '',
      ciudad_activacion: prev.ciudad_activacion || ciudadUsuario || '',
    }));
  }, [usuario]);

  const limpiarFotosSiNoSeUsan = () => {
    if (!requiereFotos) {
      setFotoRespaldo(null);
      setFotoPrincipal(null);
      actualizarCampo('foto_respaldo_url', '');
      actualizarCampo('foto_url', '');
    }
  };

  useEffect(() => {
    limpiarFotosSiNoSeUsan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiereFotos]);

  const tomarFoto = async (setter, fieldName) => {
    try {
      const camPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (camPerm.status !== 'granted') {
        return Alert.alert('Permiso denegado', 'Se requiere permiso para acceder a la cámara.');
      }

      const result = await ImagePicker.launchCameraAsync({
        // MediaTypeOptions es la opción estable; MediaType puede no estar definido en ciertas versiones
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
        allowsEditing: true,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      const uri = asset?.uri;
      if (!uri) {
        return Alert.alert('Error', 'La ruta de imagen no es válida');
      }

      let sizeMB = 0;
      try {
        const assetSize = typeof asset?.fileSize === 'number' ? asset.fileSize : null;
        if (assetSize !== null) {
          sizeMB = Number(assetSize) / 1024 / 1024;
        } else {
          const info = await FileSystem.getInfoAsync(uri, { size: true });
          sizeMB = info?.size ? Number(info.size) / 1024 / 1024 : 0;
        }
      } catch {
        // en algunos dispositivos no retorna size; continuamos
      }

      if (sizeMB > 6) {
        return Alert.alert('❌ Imagen demasiado grande', 'Intenta una foto más liviana (≤ 6 MB).');
      }

      // Persistimos la foto en documentDirectory para que no se pierda antes de sincronizar.
      const baseDir = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}activaciones-pendientes`;
      await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
      const ext = extraerExtension(uri);
      const destino = `${baseDir}/${fieldName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await FileSystem.copyAsync({ from: uri, to: destino });

      setter(destino);
      actualizarCampo(fieldName, destino);

    } catch (error) {
      console.error('❌ Error al tomar o subir imagen:', error);
      Alert.alert('Error crítico', `No se pudo procesar la imagen. ${error?.message || ''}`);
    }
  };

  const validar = (data = formulario) => {
    const impulsadorActual = data.impulsador || usuario?.nombre || '';
    if (!data.tipo_grupo) return 'Selecciona el tipo de activación (Tiendas de Barrio o Mercados).';
    if (!data.tipo_activacion) return 'Selecciona el tipo de activación específico.';
    if (!data.ciudad_activacion) return 'Selecciona la ciudad de activación.';
    if (!data.zona_activacion) return 'Selecciona la zona de activación.';
    if (!impulsadorActual) return 'No se pudo obtener el nombre del activador.';

    if (!data.nombres_cliente.trim()) return 'Ingresa los nombres del cliente.';
    if (!data.apellidos_cliente.trim()) return 'Ingresa los apellidos del cliente.';
    if (!/^\d{7,9}$/.test(data.ci_cliente)) return 'La cédula debe tener 7 a 9 números.';
    if (!/^\d{8}$/.test(data.telefono_cliente)) return 'El teléfono debe tener exactamente 8 números.';
    if (data.email_cliente && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email_cliente)) return 'El correo no parece válido.';

    if (requiereTamano && !data.tamano_tienda) {
      return 'Selecciona el tamaño de la tienda.';
    }
    if (requiereTipoComercio && !data.tipo_comercio) {
      return 'Selecciona el tipo de comercio.';
    }

    if (!data.fecha_activacion) {
      return 'No se pudo obtener la fecha de activación.';
    }

    if (requiereFotos && Platform.OS !== 'web') {
      if (!data.foto_url && !fotoPrincipal) return 'Debes cargar la foto principal (QR/comercio).';
      if (!data.foto_respaldo_url && !fotoRespaldo) return 'Debes cargar la foto de respaldo del activador.';
    }

    return null;
  };

  const guardarFormulario = async () => {
    // Asegura fecha e id si no están seteados (fallback a hoy)
    const fecha = formulario.fecha_activacion || new Date().toISOString().split('T')[0];
    const formId = formulario.id || uuidv4();
    const formularioConBasicos = {
      ...formulario,
      fecha_activacion: fecha,
      id: formId,
      impulsador: formulario.impulsador || usuario?.nombre || '',
    };
    if (!formulario.fecha_activacion || !formulario.id) {
      setFormulario(prev => ({ ...prev, fecha_activacion: fecha, id: formId }));
    }

    const errorMsg = validar(formularioConBasicos);
    if (errorMsg) {
      Alert.alert('Campo requerido', errorMsg);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(errorMsg);
      }
      return;
    }

    try {
      let latitud = null; let longitud = null;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const ubicacion = await Location.getCurrentPositionAsync({});
        latitud = ubicacion.coords.latitude;
        longitud = ubicacion.coords.longitude;
      }

      const baseActivacion = (() => {
        if (formularioConBasicos.tipo_grupo === 'tienda_barrio') return 'tienda_barrio';
        switch (formularioConBasicos.tipo_activacion) {
          case 'comercio':
          case 'reactivacion_comercio':
            return 'comercio';
          case 'transeunte':
          case 'reactivacion_transeunte':
            return 'transeunte';
          case 'limbo':
            return 'limbo';
          case 'no_habilitado':
          case 'reimpresion_qr':
          default:
            return 'none';
        }
      })();
      const esReactivacion = /reactivacion/i.test(formulario.tipo_activacion || '');

      const datosFormulario = {
        ...formularioConBasicos,
        base_activacion: baseActivacion,
        fecha_activacion: fecha,
        latitud,
        longitud,
        es_reactivacion: esReactivacion,
        usuario_id: usuario.id,
        impulsador: formulario.impulsador || usuario?.nombre || '',
        plaza: formulario.ciudad_activacion,
        foto_url: formulario.foto_url || fotoPrincipal || null,
        foto_respaldo_url: formulario.foto_respaldo_url || fotoRespaldo || null,
        estado_sync: 'offline_pending',
        dispositivo: DEVICE_INFO,
      };

      await guardarFormularioLocal(datosFormulario);
      Alert.alert('Guardado local', 'Formulario guardado localmente. ⏳');
      contarFormulariosLocales?.();
      limpiarFotosSiNoSeUsan();

      setFormulario({
        ...formularioInicial,
        id: '',
        impulsador: usuario?.nombre || '',
        ciudad_activacion: resolverCiudadKey(usuario?.plaza),
      });
      setFotoRespaldo(null);
      setFotoPrincipal(null);
    } catch (err) {
      console.error('Error al guardar formulario:', err);
      Alert.alert('Error', err?.message ? err.message : 'No se pudo guardar el formulario.');
    }
  };

  if (!usuario || !usuario.id) {
    return <Text style={{ padding: 20, color: colors.text }}>Cargando usuario...</Text>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.titulo}>Formulario de Activación</Text>
      <Text style={styles.subtitulo}>Guardados localmente: {cantidadOffline}</Text>

      <Text style={styles.sectionTitle}>Datos automáticos</Text>
      <Text style={styles.helper}>Ciudad: {formulario.ciudad_activacion || '—'}</Text>
      <Text style={styles.helper}>Zona: {formulario.zona_activacion || '—'}</Text>
      <Text style={styles.helper}>Impulsador: {formulario.impulsador || usuario?.nombre || '—'}</Text>
      <Text style={styles.helper}>Fecha: {formulario.fecha_activacion || '—'}</Text>

      {/* Grupo y tipo de activación */}
      <Text style={styles.label}>Tipo de Activación</Text>
      <Picker
        selectedValue={formulario.tipo_grupo}
        onValueChange={onGrupoChange}
        style={styles.picker}
      >
        <Picker.Item label="Seleccionar..." value="" />
        {GRUPOS_ACTIVACION.map(item => (
          <Picker.Item key={item.key} label={item.label} value={item.key} />
        ))}
      </Picker>

      {formulario.tipo_grupo ? (
        <>
          <Text style={styles.label}>
            {formulario.tipo_grupo === 'tienda_barrio'
              ? 'Tipo de Activación Tienda de Barrio'
              : 'Tipo de Activación Mercados'}
          </Text>
          <Picker
            selectedValue={formulario.tipo_activacion}
            onValueChange={onTipoActivacionChange}
            style={styles.picker}
          >
            <Picker.Item label="Seleccionar..." value="" />
            {tiposDisponibles.map(item => (
              <Picker.Item key={item.key} label={item.label} value={item.key} />
            ))}
          </Picker>
        </>
      ) : null}

      {requiereTipoComercio && (
        <>
          <Text style={styles.label}>Referencia visual</Text>
          <Image
            source={require('../assets/comercio.png')}
            style={[styles.imagenComercio, { width: imagenComercioWidth, height: imagenComercioHeight }]}
            resizeMode="cover"
          />

          <Text style={styles.label}>Tipo de Comercio</Text>
          <Picker
            selectedValue={formulario.tipo_comercio}
            onValueChange={(v) => actualizarCampo('tipo_comercio', v)}
            style={styles.picker}
          >
            <Picker.Item label="Seleccionar..." value="" />
            {TIPOS_COMERCIO.map(item => (
              <Picker.Item key={item} label={item} value={item} />
            ))}
          </Picker>
        </>
      )}

      {requiereTamano && (
        <>
          <Text style={styles.label}>Tamaño de la tienda</Text>
          <Picker
            selectedValue={formulario.tamano_tienda}
            onValueChange={(v) => actualizarCampo('tamano_tienda', v)}
            style={styles.picker}
          >
            <Picker.Item label="Seleccionar..." value="" />
            {TAMANOS_TIENDA.map(item => (
              <Picker.Item key={item} label={item} value={item} />
            ))}
          </Picker>
        </>
      )}

      <Text style={styles.label}>Ciudad de Activación</Text>
      <Picker
        selectedValue={formulario.ciudad_activacion}
        onValueChange={(v) => {
          actualizarCampo('ciudad_activacion', v);
          actualizarCampo('zona_activacion', '');
        }}
        style={styles.picker}
      >
        <Picker.Item label="Seleccionar..." value="" />
        {CIUDADES.map(item => (
          <Picker.Item key={item.key} label={item.label} value={item.key} />
        ))}
      </Picker>

      <Text style={styles.label}>Zona de Activación</Text>
      <Picker
        selectedValue={formulario.zona_activacion}
        onValueChange={(v) => actualizarCampo('zona_activacion', v)}
        style={styles.picker}
        enabled={!!formulario.ciudad_activacion}
      >
        <Picker.Item label="Seleccionar..." value="" />
        {zonasDisponibles.map(z => (
          <Picker.Item key={z} label={z} value={z} />
        ))}
      </Picker>

      <Text style={styles.sectionTitle}>Datos del Cliente</Text>
      <Text style={styles.label}>Nombres</Text>
      <TextInput
        style={styles.input}
        value={formulario.nombres_cliente}
        onChangeText={(v) => actualizarCampo('nombres_cliente', v)}
      />

      <Text style={styles.label}>Apellidos</Text>
      <TextInput
        style={styles.input}
        value={formulario.apellidos_cliente}
        onChangeText={(v) => actualizarCampo('apellidos_cliente', v)}
      />

      <Text style={styles.label}>Cédula de Identidad</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        maxLength={9}
        value={formulario.ci_cliente}
        onChangeText={(v) => actualizarCampo('ci_cliente', v.replace(/\D/g, ''))}
      />

      <Text style={styles.label}>Teléfono</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        maxLength={8}
        value={formulario.telefono_cliente}
        onChangeText={(v) => actualizarCampo('telefono_cliente', v.replace(/\D/g, ''))}
      />

      <Text style={styles.label}>Correo Electrónico</Text>
      <TextInput
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
        value={formulario.email_cliente}
        onChangeText={(v) => actualizarCampo('email_cliente', v)}
      />

      <Text style={styles.sectionTitle}>Datos de la Activación</Text>
      {['descargo_app', 'registro', 'cash_in', 'cash_out', 'p2p', 'qr_fisico', 'respaldo'].map(key => (
        <View key={key} style={styles.switchRow}>
          <Text style={styles.label}>{key.replace(/_/g, ' ').toUpperCase()}</Text>
          <Switch
            value={formulario[key]}
            onValueChange={(v) => actualizarCampo(key, v)}
            trackColor={{ false: colors.inputBorder, true: colors.primary }}
          />
        </View>
      ))}

      <Text style={styles.label}>¿Hubo error?</Text>
      <Switch
        value={formulario.hubo_error}
        onValueChange={(v) => actualizarCampo('hubo_error', v)}
        trackColor={{ false: colors.inputBorder, true: colors.warning }}
      />
      {formulario.hubo_error && (
        <>
          <Text style={styles.label}>Descripción del error</Text>
          <TextInput
            value={formulario.descripcion_error}
            onChangeText={(v) => actualizarCampo('descripcion_error', v)}
            style={styles.input}
          />
        </>
      )}

      {requiereFotos ? (
        <>
          <Text style={styles.sectionTitle}>Fotografías</Text>
          <Text style={styles.label}>Foto principal (QR/Comercio)</Text>
          <TouchableOpacity
            onPress={() => tomarFoto(setFotoPrincipal, 'foto_url')}
            style={[styles.botonMini, { backgroundColor: colors.primary, ...botonShadow }]}
          >
            <Text style={styles.botonTextoMini}>📷 Tomar Foto</Text>
          </TouchableOpacity>
          {fotoPrincipal ? <Image source={{ uri: fotoPrincipal }} style={styles.imagenMiniatura} /> : null}

          <Text style={styles.label}>Respaldo del activador</Text>
          <TouchableOpacity
            onPress={() => tomarFoto(setFotoRespaldo, 'foto_respaldo_url')}
            style={[styles.botonMini, { backgroundColor: colors.primary, ...botonShadow }]}
          >
            <Text style={styles.botonTextoMini}>📷 Tomar Foto</Text>
          </TouchableOpacity>
          {fotoRespaldo ? <Image source={{ uri: fotoRespaldo }} style={styles.imagenMiniatura} /> : null}
        </>
      ) : null}

      <View style={styles.botonesRow}>
        <TouchableOpacity
          onPress={guardarFormulario}
          style={[styles.botonMini, { backgroundColor: colors.primary, ...botonShadow }]}
        >
          <Text style={styles.botonTextoMini}>💾 Guardar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSincronizar}
          style={[styles.botonMini, { backgroundColor: colors.success, ...botonShadow }]}
        >
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
  sectionTitle: { fontSize: fontSizes.large, fontWeight: '600', marginTop: spacing.lg, color: colors.primary },
  label: { fontSize: fontSizes.medium, marginTop: spacing.sm, marginBottom: spacing.xs, color: colors.text },
  input: { borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm, color: colors.text },
  picker: { backgroundColor: colors.inputBackground, borderRadius: radius.md, marginBottom: spacing.sm },
  helper: { color: colors.muted, marginBottom: spacing.xs },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
  },
  botonesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  botonMini: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    minWidth: 90,
  },
  botonTextoMini: { color: '#fff', fontSize: fontSizes.medium, fontWeight: '600', textAlign: 'center' },
  imagenMiniatura: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  imagenComercio: {
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    alignSelf: 'center',
  },
});
