import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
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
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import { guardarFormularioLocal } from '../lib/storage';
import { prepararImagenPersistente } from '../lib/upload';
import { normalizarNombreVisible } from '../lib/identity';
import { colors, spacing, fontSizes, radius, shadow } from '../styles/theme';

const DEVICE_INFO = `react-native-${Platform.OS}`;

const GRUPOS_ACTIVACION = [
  { key: 'tienda_barrio', label: 'Tiendas de Barrio' },
  { key: 'comercio', label: 'Comercio' },
  { key: 'transeunte', label: 'Transeúnte' },
];

const TIPOS_TIENDAS = [
  { key: 'comercio', label: 'Comercio' },
  { key: 'no_habilitado', label: 'No habilitado' },
  { key: 'reactivacion', label: 'Reactivación' },
  { key: 'config_cuenta', label: 'Configuración de cuenta' },
  { key: 'reimpresion_qr', label: 'Reimpresión QR' },
];

const TIPOS_COMERCIO_ACTIVACION = [
  { key: 'comercio', label: 'Comercio' },
  { key: 'reactivacion_comercio', label: 'Reactivación Comercio' },
  { key: 'limbo', label: 'Limbo (Configuración de Cuenta)' },
  { key: 'no_habilitado', label: 'No habilitado' },
  { key: 'reimpresion_qr', label: 'Reimpresión QR' },
];

const TIPOS_TRANSEUNTE = [
  { key: 'transeunte', label: 'Transeúnte' },
  { key: 'reactivacion_transeunte', label: 'Reactivación Transeúnte' },
];

const TAMANOS_TIENDA = ['Pequeña', 'Mediana', 'Grande'];
const TIPOS_COMERCIO = ['Comercio', 'Hogar y Muebles', 'Transporte y Servicio', 'Cuidado Personal y Belleza', 'Educación y Entretenimiento', 'Consumo'];
const RUBROS_COMERCIO = [
  'Comercio',
  'Servicios Profesionales',
  'Servicio de Comida',
  'Servicio de Transporte',
  'Manufactura Artesanal',
  'Ambulantes',
  'Servicios Personales',
  'Reparación de Vehículos',
];
const GUIA_RUBROS = [
  ['Comercio', 'Ferreterías; Tiendas de Barrio; Frutas y Verduras; Ropa, accesorios y artículos del hogar; Tecnología y repuestos.'],
  ['Servicios Profesionales', 'Abogados, contadores y otros.'],
  ['Servicio de Comida', 'Restaurantes; servicios de comida.'],
  ['Servicio de Transporte', 'Taxi, mototaxi, buses, delivery y otros.'],
  ['Manufactura Artesanal', 'Artesanías, tejidos, bisutería y otros.'],
  ['Ambulantes', 'Venta directa en vía pública, sin local fijo.'],
  ['Servicios Personales', 'Salones de belleza, gimnasios y otros.'],
  ['Reparación de Vehículos', 'Talleres, cambio de aceite y otros.'],
];
const TIPOS_ERROR = ['Conectividad', 'Aplicación', 'Registro', 'Cash-In', 'Otro'];

const CIUDADES = [
  {
    key: 'santa_cruz',
    label: 'Santa Cruz',
    zonas: [
      'Distrito Municipal 1: Piraí',
      'Distrito Municipal 2: Norte Interno',
      'Distrito Municipal 3: Estación Argentina',
      'Distrito Municipal 4: El Pari',
      'Distrito Municipal 5: Norte',
      'Distrito Municipal 6: Carretera Cotoca',
      'Distrito Municipal 7: Villa 1ro de Mayo',
      'Distrito Municipal 8: Plan 3000',
      'Distrito Municipal 9: Palmasola',
      'Distrito Municipal 10: El Bajío',
      'Distrito Municipal 11: Centro',
      'Distrito Municipal 12: Nuevo Palmar',
      'Distrito Municipal 13: Zona Industrial',
      'San Julian',
      '4 Cañadas',
      'La Guardia',
      'Paurito',
      'Concepcion',
      'El Torno',
      'Samaipata',
      'BBO',
    ],
  },
  {
    key: 'el_alto',
    label: 'El Alto',
    zonas: [
      'Distrito Municipal 1',
      'Distrito Municipal 2',
      'Distrito Municipal 3',
      'Distrito Municipal 4',
      'Distrito Municipal 5',
      'Distrito Municipal 6',
      'Distrito Municipal 7',
      'Distrito Municipal 8',
      'Distrito Municipal 9',
      'Distrito Municipal 10',
      'Distrito Municipal 11',
      'Distrito Municipal 12',
      'Distrito Municipal 13',
      'Distrito Municipal 14',
    ],
  },
  {
    key: 'la_paz',
    label: 'La Paz',
    zonas: ['Centro', 'Cotahuma', 'Mallasa', 'Max Paredes', 'Periférica', 'San Antonio', 'Sur'],
  },
  {
    key: 'cochabamba',
    label: 'Cochabamba',
    zonas: ['Norte', 'Sur', 'Este', 'Oeste', 'Central', 'Sacaba', 'Quillacollo', 'Tiquipaya'],
  },
  {
    key: 'oruro',
    label: 'Oruro',
    zonas: [
      'Sajama',
      'Mejillones',
      'Atahuallpa',
      'Litoral',
      'Carangas',
      'Sur carangas',
      'Ladislao Cabrera',
      'Avaroa',
      'Sebastian Pagador',
      'Poopó',
      'Saucari',
      'Cercado',
      'Dalence',
      'San Pedro de Totora',
      'Nor Carangas',
      'Tomas Barrón',
    ],
  },
  {
    key: 'montero',
    label: 'Montero',
    zonas: [
      'Mercado Villa Verde',
      'Mercado Popular',
      'Mercado Central de Montero',
      'Mercado El Alba',
      'Mercado Germán Moreno',
      'Abasto del Norte Mercado Privado',
      'Otros',
    ],
  },
  {
    key: 'san_ignacio',
    label: 'San Ignacio',
    zonas: ['San Ignacio'],
  },
  {
    key: 'tarija',
    label: 'Tarija',
    zonas: [
      'El Molino',
      'Zona Centro',
      'Mercado Central',
      'Mercado Campesino',
      'Bolivar',
      'La Loma',
      'La Pampa',
      'Las Panosas',
      'Villa Fatima',
      'Los Alamos',
      'Senac',
      'Los chapacos',
      'Gamoneda',
      'La Florida',
      'Eduardo Avaroa',
      'General Jose Martin',
      'Andaluz',
      'El Dorado',
      'Lourdes',
      'Abasto',
      'San Geronimo',
      'San Bernardo',
      'Pedro Antonio Flores',
      'Morros Blancos',
      'Universidad Autonoma Juan Misael Saracho',
      'San Lorenzo',
      'Yacuiba',
      'Panamericana',
      'San Antonio',
      'Juan XXIII',
      'Parque Tematico',
      'Miraflores',
      'Mendez arcos',
      'Plaza Principal',
      'Mercado San Martin',
      'Tabladita',
      'BBO',
    ],
  },
  {
    key: 'trinidad',
    label: 'Trinidad',
    zonas: [
      'BARRIO 30 DE JULIO',
      'JUNTA LIBERTAD',
      'BARRIO 6 DE JUNIO',
      'BARRIO COTOCA',
      'BARRIO EL TRIUNFO',
      'BARRIO MANGALITO',
      'BARRIO MOPERITA',
      'URBANIZACION EL PRADO',
      'BARRIO NUEVO AMANECER',
      'BARRIO VILLA VECINAL',
      'BARRIO PANTANAL',
      'JUNTA EL SUJO',
      'BARRIO PLATAFORMA',
      'BARRIO POZO OXIDACION',
      'JUNTA 1RO DE MAYO',
      'BARRIO SAN MARTIN',
      'BARRIO 17 DE JUNIO',
      'BARRIO SAN PEDRO',
      'VILLA MONASTERIO',
      'BARRIO SAN RAMONCITO',
      'JUNTA LOS ALAMOS',
      'BARRIO SANDUNGA',
      'JUNTA PROVINCIAS UNIDAS',
      'BARRIO SANTA MARIA',
      'BARRIO EL RECREO',
      'BARRIO URKUPIÑA',
      'BARRIO VIRGEN DEL ROSARIO',
      'BARRIO V. MAGDALENA',
      'BARRIO NIÑA AUTONOMA',
      'BARRIO VACA MEDRANO',
      'BARRIO VILLA JIMENA',
      'BIM.TOCOPILLA',
      'BARRIO VILLA LOLITA',
      'BARRIO VILLA MILDRE',
      'BARRIO VILLA MARIN FINAL- BARRIO PEDRO IG. MUIBA',
      'BARRIO VILLA MOISES',
      'CAMPUS UNIVERSITARIO UAB',
      'URBANIZACION MANA',
      'CEMENTERIO COVID',
      'CEMENTERIO JARDIN',
      'NORMAL DE MAESTROS',
      'EDMUNDO VACA MEDRANO',
      'URBANIZACION LAS PALMAS',
      'URBANIZACION SANTA INES',
      'URB. TAHICHI',
      'URBANIZACION UNIVERSITARIA',
      'BARRIO PATUJU II',
      'BARRIO 13 DE ABRIL',
      'BARRIO ARROYO CHICO',
      'ZONA BELLO HORIZONTE',
      'ZONA LAS BRISAS',
      'ZONA CHAPARRAL',
      'ZONA EL PALMAR',
      'ZONA EL CARMEN',
      'BARRIO LOS TOCOS',
      'BARRIO NUEVA TRINIDAD',
      'BARRIO EL ROSARIO',
      'BARRIO PAITITI',
      'BARRIO 12 DE ABRIL',
      'MERCADO CAMPESINO',
      'MERCADO POMPEYA',
      'MERCADO CENTRAL',
      'MERCADO COCHABAMBA',
      'MERCADO FATIMA',
      'MERCADO 13 DE ABRIL',
      'MERCADO PAITITI',
      'MERCADO VILLA VECINAL',
    ],
  },
  {
    key: 'sucre',
    label: 'Sucre',
    zonas: ['Distrito 1', 'Distrito 2', 'Distrito 3', 'Distrito 4', 'Distrito 5'],
  },
];

const CIUDAD_ALIASES = {
  santa_cruz: ['santa_cruz', 'santa_cruz_de_la_sierra', 'andres_ibanez'],
  el_alto: ['el_alto'],
  la_paz: ['la_paz', 'nuestra_senora_de_la_paz', 'murillo'],
  cochabamba: ['cochabamba'],
  oruro: ['oruro'],
  montero: ['montero'],
  san_ignacio: ['san_ignacio', 'san_ignacio_de_velasco'],
  tarija: ['tarija'],
  trinidad: ['trinidad'],
  sucre: ['sucre', 'chuquisaca'],
};

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

const formularioInicial = {
  tipo_grupo: '',
  tipo_activacion: '',
  id: '',
  tamano_tienda: '',
  tipo_comercio: '',
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
  tipo_error: '',
  latitud: null,
  longitud: null,
  base_activacion: '',
  es_reactivacion: false,
  foto_url: '',
  foto_cash_in: '',
  tipo_tienda: '',
  rubro_comercio: '',
  rubro_comercio_otro: '',
  comercio_fuera_mercado: null,
  es_plaza_temporal: false,
  plaza_temporal: null,
  estado_sync: 'offline_pending',
  dispositivo: DEVICE_INFO,
};

export default function FormularioActivacion({
  cantidadOffline,
  contarFormulariosLocales,
  isConnected,
  onSincronizar,
  onVerActivaciones,
  usuario,
}) {
  const [formulario, setFormulario] = useState(formularioInicial);
  const [fotoPrincipal, setFotoPrincipal] = useState(null);
  const [fotoCashIn, setFotoCashIn] = useState(null);
  const [evidenciaPreview, setEvidenciaPreview] = useState(null);
  const [guiaRubrosVisible, setGuiaRubrosVisible] = useState(false);
  const [estadoGuardado, setEstadoGuardado] = useState('');
  const [activacionGuardada, setActivacionGuardada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const [detectandoCiudad, setDetectandoCiudad] = useState(isConnected !== false);
  const { width, height } = useWindowDimensions();
  const guiaRubrosImageHeight = Math.max(
    110,
    Math.min(220, (width - spacing.md * 4) / 1.5, height * 0.25),
  );
  const botonShadow = Platform.OS === 'web'
    ? { boxShadow: '0px 2px 6px rgba(0,0,0,0.3)' }
    : shadow.base;

  const actualizarCampo = (campo, valor) => {
    setFormulario(prev => ({ ...prev, [campo]: valor }));
  };

  const tiposDisponibles = formulario.tipo_grupo === 'tienda_barrio'
    ? TIPOS_TIENDAS
    : formulario.tipo_grupo === 'comercio'
      ? TIPOS_COMERCIO_ACTIVACION
      : formulario.tipo_grupo === 'transeunte'
        ? TIPOS_TRANSEUNTE
        : [];

  const ciudadSeleccionada = useMemo(
    () => CIUDADES.find(c => c.key === formulario.ciudad_activacion) || null,
    [formulario.ciudad_activacion],
  );
  const zonasDisponibles = useMemo(
    () => ciudadSeleccionada?.zonas || [],
    [ciudadSeleccionada],
  );
  const ciudadLabel = ciudadSeleccionada?.label || formulario.ciudad_activacion || '';

  useEffect(() => {
    if (!formulario.ciudad_activacion) return;
    if (zonasDisponibles.length !== 1) return;
    if (formulario.zona_activacion) return;
    setFormulario((prev) => ({ ...prev, zona_activacion: zonasDisponibles[0] }));
  }, [formulario.ciudad_activacion, formulario.zona_activacion, zonasDisponibles]);

  const baseActivacionPreview = useMemo(() => {
    if (formulario.tipo_grupo === 'tienda_barrio') return 'tienda_barrio';
    if (formulario.tipo_grupo === 'transeunte') return 'transeunte';
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

  const requiereTiendaBarrio = formulario.tipo_grupo === 'tienda_barrio';
  const requiereComercio = formulario.tipo_grupo === 'comercio';
  const requiereComercioGeneral =
    requiereComercio && baseActivacionPreview === 'comercio';

  const requiereFotos = true;
  const plazasTemporales = useMemo(
    () => Array.isArray(usuario?.plazas_temporales) ? usuario.plazas_temporales : [],
    [usuario?.plazas_temporales],
  );
  const plazaTemporalSeleccionada = plazasTemporales.find(
    (item) => item?.nombre === formulario.plaza_temporal,
  );
  const plazaSeleccionada = formulario.es_plaza_temporal && plazaTemporalSeleccionada
    ? `temporal:${plazaTemporalSeleccionada.id}`
    : 'base';

  const onPlazaChange = (value) => {
    if (value === 'base') {
      setFormulario((prev) => ({ ...prev, es_plaza_temporal: false, plaza_temporal: null }));
      return;
    }
    const plazaId = String(value).replace(/^temporal:/, '');
    const plaza = plazasTemporales.find((item) => item?.id === plazaId);
    if (!plaza) return;
    setFormulario((prev) => ({ ...prev, es_plaza_temporal: true, plaza_temporal: plaza.nombre }));
  };

  const onGrupoChange = (grupo) => {
    setFormulario(prev => ({
      ...prev,
      tipo_grupo: grupo,
      tipo_activacion: '',
      tamano_tienda: '',
      tipo_comercio: '',
      tipo_tienda: '',
      rubro_comercio: '',
      rubro_comercio_otro: '',
      comercio_fuera_mercado: null,
    }));
  };

  const onTipoActivacionChange = (key) => {
    const conservaComercioGeneral =
      formulario.tipo_grupo === 'comercio' &&
      ['comercio', 'reactivacion_comercio'].includes(key);
    setFormulario(prev => ({
      ...prev,
      tipo_activacion: key,
      ...(!conservaComercioGeneral
        ? { tipo_comercio: '', rubro_comercio: '', rubro_comercio_otro: '', comercio_fuera_mercado: null }
        : {}),
    }));
  };

  const resolverCiudadDesdeDireccion = (dir = {}) => {
    const candidatos = [dir.city, dir.district, dir.subregion, dir.region, dir.name]
      .filter(Boolean)
      .map((v) => normalizarCiudad(v));

    for (const candidato of candidatos) {
      const directa = resolverCiudadKey(candidato);
      if (directa) return directa;

      for (const [key, aliases] of Object.entries(CIUDAD_ALIASES)) {
        if (aliases.some((alias) => candidato.includes(alias))) {
          return key;
        }
      }
    }
    return '';
  };

  const detectarCiudadPorGps = useCallback(async ({ silent = false } = {}) => {
    if (Platform.OS === 'web') return;
    setDetectandoCiudad(true);
    try {
      const permiso = await Location.requestForegroundPermissionsAsync();
      if (permiso.status !== 'granted') {
        if (!silent) {
          Alert.alert('Ubicación desactivada', 'Activa el permiso de ubicación para detectar la ciudad automáticamente.');
        }
        return;
      }

      const ubicacion = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const geocoded = await Location.reverseGeocodeAsync({
        latitude: ubicacion.coords.latitude,
        longitude: ubicacion.coords.longitude,
      });

      let ciudadGps = resolverCiudadDesdeDireccion(geocoded?.[0] || {});
      if (!ciudadGps) {
        ciudadGps = resolverCiudadKey(usuario?.plaza);
      }
      if (!ciudadGps) {
        if (!silent) {
          Alert.alert(
            'Ciudad no detectada',
            'No pudimos identificar la ciudad con GPS. Revisa la ubicación del dispositivo e intenta nuevamente.'
          );
        }
        return;
      }

      setFormulario((prev) => ({
        ...prev,
        ciudad_activacion: ciudadGps,
        zona_activacion: prev.ciudad_activacion === ciudadGps ? prev.zona_activacion : '',
      }));
    } catch (error) {
      console.warn('No se pudo detectar ciudad por GPS:', error?.message || error);
      if (!silent) {
        Alert.alert('Error de ubicación', 'No se pudo obtener la ubicación actual.');
      }
    } finally {
      setDetectandoCiudad(false);
    }
  }, [usuario?.plaza]);

  // Auto-set de datos provenientes del usuario y fecha actual
  useEffect(() => {
    const hoy = new Date().toISOString().split('T')[0];
    const ciudadUsuario = resolverCiudadKey(usuario?.plaza);
    const nombreUsuario = normalizarNombreVisible(usuario?.nombre || '');
    setFormulario(prev => ({
      ...prev,
      fecha_activacion: prev.fecha_activacion || hoy,
      impulsador: prev.impulsador || nombreUsuario || '',
      ciudad_activacion: prev.ciudad_activacion || (!isConnected ? ciudadUsuario : '') || '',
    }));
  }, [isConnected, usuario]);

  useEffect(() => {
    if (isConnected === false) return;
    if (formulario.ciudad_activacion) return;
    detectarCiudadPorGps({ silent: true });
  }, [detectarCiudadPorGps, formulario.ciudad_activacion, isConnected]);

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
      const destino = await prepararImagenPersistente(uri, fieldName);
      const anterior = formulario[fieldName];
      if (/^file:\/\//i.test(anterior || '') && anterior !== destino) {
        await FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => {});
      }

      setter(destino);
      actualizarCampo(fieldName, destino);

    } catch (error) {
      console.error('❌ Error al tomar o subir imagen:', error);
      Alert.alert('Error crítico', `No se pudo procesar la imagen. ${error?.message || ''}`);
    }
  };

  const seleccionarImagen = async (setter, fieldName) => {
    try {
      const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permiso.status !== 'granted') {
        return Alert.alert('Permiso denegado', 'Se requiere permiso para acceder a la galería.');
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
        allowsEditing: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return Alert.alert('Error', 'La ruta de imagen no es válida.');
      const size = typeof asset.fileSize === 'number'
        ? asset.fileSize
        : (await FileSystem.getInfoAsync(asset.uri, { size: true }).catch(() => null))?.size;
      if (size && size / 1024 / 1024 > 6) {
        return Alert.alert('❌ Imagen demasiado grande', 'Selecciona una imagen más liviana (≤ 6 MB).');
      }
      const destino = await prepararImagenPersistente(asset.uri, fieldName);
      const anterior = formulario[fieldName];
      if (/^file:\/\//i.test(anterior || '') && anterior !== destino) {
        await FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => {});
      }
      setter(destino);
      actualizarCampo(fieldName, destino);
    } catch (error) {
      console.error('❌ Error al seleccionar imagen:', error);
      Alert.alert('Error crítico', `No se pudo procesar la imagen. ${error?.message || ''}`);
    }
  };

  const eliminarFoto = async (setter, fieldName) => {
    const uri = formulario[fieldName];
    if (/^file:\/\//i.test(uri || '')) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    setter(null);
    actualizarCampo(fieldName, '');
  };

  const abrirEvidencia = (uri, setter, fieldName, label) => {
    if (!uri) {
      if (fieldName === 'foto_cash_in') {
        Alert.alert('Evidencia Cash-In', 'Selecciona el origen de la imagen.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Galería', onPress: () => seleccionarImagen(setter, fieldName) },
          { text: 'Cámara', onPress: () => tomarFoto(setter, fieldName) },
        ]);
      } else {
        tomarFoto(setter, fieldName);
      }
      return;
    }
    setEvidenciaPreview({ uri, setter, fieldName, label });
  };

  const cambiarEvidencia = () => {
    const actual = evidenciaPreview;
    if (!actual) return;
    setEvidenciaPreview(null);
    tomarFoto(actual.setter, actual.fieldName);
  };

  const eliminarEvidencia = async () => {
    const actual = evidenciaPreview;
    if (!actual) return;
    setEvidenciaPreview(null);
    await eliminarFoto(actual.setter, actual.fieldName);
  };

  const validar = (data = formulario) => {
    const impulsadorActual = normalizarNombreVisible(data.impulsador || usuario?.nombre || '');
    const telefonoNormalizado = String(data.telefono_cliente || '').replace(/\D/g, '');
    const carnetNormalizado = String(data.ci_cliente || '').replace(/\D/g, '');
    if (!data.tipo_grupo) return 'Selecciona el tipo de activación (Tiendas de Barrio, Comercio o Transeúnte).';
    if (!data.tipo_activacion) return 'Selecciona el tipo de activación específico.';
    if (!data.ciudad_activacion) {
      return isConnected === false
        ? 'Selecciona la ciudad de activación.'
        : 'No se pudo detectar la ciudad por GPS. Pulsa "Actualizar ubicación".';
    }
    if (!data.zona_activacion) return 'Selecciona la zona de activación.';
    if (!impulsadorActual) return 'No se pudo obtener el nombre del activador.';

    if (!data.nombres_cliente.trim()) return 'Ingresa los nombres del cliente.';
    if (!data.apellidos_cliente.trim()) return 'Ingresa los apellidos del cliente.';
    if (!/^\d{7,9}$/.test(carnetNormalizado)) return 'La cédula debe tener 7 a 9 números.';
    if (!/^\d{8}$/.test(telefonoNormalizado)) return 'El teléfono debe tener exactamente 8 números.';
    if (telefonoNormalizado && telefonoNormalizado === carnetNormalizado) {
      return 'El número de teléfono no puede ser igual al carnet';
    }
    if (data.email_cliente && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email_cliente)) return 'El correo no parece válido.';

    if (requiereTiendaBarrio && !data.tamano_tienda) {
      return 'Selecciona el tamaño de la tienda.';
    }
    if (requiereComercioGeneral && !data.tipo_comercio) {
      return 'Selecciona el tipo de comercio.';
    }
    // Nota: `tipo_tienda` se mantiene en el estado para compatibilidad,
    // pero la UI ya usa `tamano_tienda` como campo único de tamaño.
    if (requiereComercioGeneral && !data.rubro_comercio) return 'Selecciona el rubro del comercio.';
    if (requiereComercioGeneral && data.comercio_fuera_mercado === null) return 'Indica si el comercio está fuera del mercado.';
    if (data.hubo_error && !data.tipo_error) return 'Selecciona el tipo de error.';
    if (data.hubo_error && data.tipo_error === 'Otro' && !data.descripcion_error.trim()) return 'Describe el error.';
    if (data.es_plaza_temporal && !plazasTemporales.some((item) => item?.nombre === data.plaza_temporal)) return 'La plaza temporal seleccionada no está autorizada.';

    if (!data.fecha_activacion) {
      return 'No se pudo obtener la fecha de activación.';
    }

    if (!data.foto_url && !fotoPrincipal) return 'Debes cargar la foto de comprobación.';
    if (!data.foto_cash_in && !fotoCashIn) return 'Debes cargar la foto del Cash-In.';

    return null;
  };

  const fotoPrincipalUri = fotoPrincipal || formulario.foto_url;
  const fotoCashInUri = fotoCashIn || formulario.foto_cash_in;
  const fotosCapturadas = Number(Boolean(fotoPrincipalUri)) + Number(Boolean(fotoCashInUri));
  const gpsResumen = detectandoCiudad
    ? 'Detectando'
    : formulario.ciudad_activacion
      ? 'Listo'
      : 'Pendiente';
  const faltanteActual = validar(formulario);
  const formularioCompleto = !faltanteActual;

  const guardarFormulario = async () => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setEstadoGuardado('Guardando…');
    // Asegura fecha e id si no están seteados (fallback a hoy)
    const fecha = formulario.fecha_activacion || new Date().toISOString().split('T')[0];
    const formId = formulario.id || uuidv4();
    const formularioConBasicos = {
      ...formulario,
      fecha_activacion: fecha,
      id: formId,
      impulsador: normalizarNombreVisible(formulario.impulsador || usuario?.nombre || ''),
    };
    if (!formulario.fecha_activacion || !formulario.id) {
      setFormulario(prev => ({ ...prev, fecha_activacion: fecha, id: formId }));
    }

    const errorMsg = validar(formularioConBasicos);
    if (errorMsg) {
      guardandoRef.current = false;
      setGuardando(false);
      setEstadoGuardado(`Error: ${errorMsg}`);
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
        if (formularioConBasicos.tipo_grupo === 'transeunte') return 'transeunte';
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
        impulsador: formularioConBasicos.impulsador,
        plaza: formularioConBasicos.es_plaza_temporal
          ? formularioConBasicos.plaza_temporal
          : usuario.plaza,
        foto_url: formulario.foto_url || fotoPrincipal || null,
        foto_cash_in: formulario.foto_cash_in || fotoCashIn || null,
        estado_sync: 'offline_pending',
        dispositivo: DEVICE_INFO,
      };

      await guardarFormularioLocal(datosFormulario);
      setEstadoGuardado('Guardada localmente');
      contarFormulariosLocales?.();
      let syncResult = { status: 'offline' };
      if (isConnected) {
        try {
          syncResult = await onSincronizar?.({ showAlerts: false, force: true });
        } catch (syncError) {
          console.error('Error al sincronizar formulario guardado:', syncError);
          syncResult = { status: 'error' };
        }
      }
      if (syncResult?.status === 'synced' || syncResult?.synced > 0) {
        setEstadoGuardado('Sincronizada');
      } else if (syncResult?.status === 'error') {
        setEstadoGuardado('Guardada localmente · error al sincronizar');
      } else {
        setEstadoGuardado('Guardada localmente · pendiente de sincronización');
      }
      setFormulario({
        ...formularioInicial,
        id: '',
        impulsador: normalizarNombreVisible(usuario?.nombre || ''),
        ciudad_activacion: isConnected === false
          ? resolverCiudadKey(usuario?.plaza)
          : formularioConBasicos.ciudad_activacion,
      });
      setFotoPrincipal(null);
      setFotoCashIn(null);
      setActivacionGuardada(true);
      setEstadoGuardado('Activación guardada correctamente. Este registro ya no puede ser modificado.');
    } catch (err) {
      console.error('Error al guardar formulario:', err);
      Alert.alert('Error', err?.message ? err.message : 'No se pudo guardar el formulario.');
      setEstadoGuardado(`Error: ${err?.message || 'No se pudo guardar'}`);
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  if (!usuario || !usuario.id) {
    return <Text style={{ padding: 20, color: colors.text }}>Cargando usuario...</Text>;
  }

  if (activacionGuardada) {
    return (
      <View style={[styles.container, width <= 430 && styles.containerMobile]}>
        <View style={styles.saveDoneCard}>
          <Text style={styles.saveDoneTitle}>Activación guardada</Text>
          <Text style={styles.saveDoneText}>
            Activación guardada correctamente. Este registro ya no puede ser modificado.
          </Text>
          <View style={styles.saveDoneActions}>
            <TouchableOpacity
              onPress={() => {
                setActivacionGuardada(false);
                setEstadoGuardado('');
              }}
              style={[styles.saveDoneButton, { backgroundColor: colors.primary, ...botonShadow }]}
              activeOpacity={0.85}
            >
              <Text style={styles.botonTextoMini}>Nueva Activación</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onVerActivaciones}
              style={[styles.saveDoneButton, styles.saveDoneButtonSecondary]}
              activeOpacity={0.85}
            >
              <Text style={styles.saveDoneButtonSecondaryText}>Ver Activaciones</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, width <= 430 && styles.containerMobile]}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heroCard}>
        <Text style={styles.titulo}>Formulario de Activación</Text>
        <Text style={styles.subtitulo}>Registro en campo y sincronización segura</Text>
        <View style={styles.heroMetaRow}>
          <View style={[styles.badge, styles.badgePrimary]}>
            <Text style={styles.badgeText}>Pendientes: {cantidadOffline}</Text>
          </View>
          <View style={[styles.badge, styles.badgeAccent]}>
            <Text style={styles.badgeText}>2 fotos obligatorias</Text>
          </View>
          {!!formulario.fecha_activacion && (
            <View style={[styles.badge, styles.badgeNeutral]}>
              <Text style={styles.badgeText}>Fecha · {formulario.fecha_activacion}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={[styles.card, styles.compactCard]}>
        <Text style={styles.sectionTitle}>Ubicación</Text>
        {isConnected === false ? (
          <>
            <Text style={styles.locationStatus}>Ubicación guardada para modo offline</Text>
            <Text style={styles.label}>Ciudad de Activación</Text>
            <Picker
              selectedValue={formulario.ciudad_activacion}
              onValueChange={(v) => setFormulario((prev) => ({ ...prev, ciudad_activacion: v, zona_activacion: '' }))}
              style={styles.picker}
            >
              <Picker.Item label="Seleccionar..." value="" />
              {CIUDADES.map((item) => <Picker.Item key={item.key} label={item.label} value={item.key} />)}
            </Picker>
          </>
        ) : (
          <>
            <Text style={styles.locationStatus}>
              {detectandoCiudad
                ? 'Detectando ubicación...'
                : ciudadLabel
                  ? 'Ubicación obtenida'
                  : 'No se pudo obtener ubicación'}
            </Text>
            {!!ciudadLabel && (
              <View style={styles.locationSummary}>
                <Text style={styles.helperLabel}>Ciudad detectada</Text>
                <Text style={styles.helperValue}>{ciudadLabel}</Text>
              </View>
            )}
            {zonasDisponibles.length === 1 && !!formulario.zona_activacion && (
              <View style={styles.locationSummary}>
                <Text style={styles.helperLabel}>Zona detectada</Text>
                <Text style={styles.helperValue}>{formulario.zona_activacion}</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.gpsButton, detectandoCiudad && styles.botonDisabled]}
              onPress={() => detectarCiudadPorGps()}
              disabled={detectandoCiudad}
              activeOpacity={0.85}
            >
              {detectandoCiudad ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.gpsButtonText}>Actualizar ubicación</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.statusSummary}>
        <View style={styles.statusSummaryItem}>
          <Text style={styles.statusSummaryLabel}>GPS</Text>
          <Text style={styles.statusSummaryValue}>{gpsResumen}</Text>
        </View>
        <View style={styles.statusSummaryItem}>
          <Text style={styles.statusSummaryLabel}>Fotos</Text>
          <Text style={styles.statusSummaryValue}>{fotosCapturadas}/2</Text>
        </View>
        <View style={styles.statusSummaryItem}>
          <Text style={styles.statusSummaryLabel}>Formulario</Text>
          <Text style={[styles.statusSummaryValue, formularioCompleto ? styles.statusOk : styles.statusPending]}>
            {formularioCompleto ? 'Completo' : 'Incompleto'}
          </Text>
        </View>
        {!formularioCompleto && <Text style={styles.missingHint}>{faltanteActual}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Activación</Text>

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
            {requiereTiendaBarrio && (
              <>
                <Text style={styles.label}>Tamaño de la tienda</Text>
                <Picker
                  selectedValue={formulario.tamano_tienda || ''}
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

            <Text style={styles.label}>
              {formulario.tipo_grupo === 'tienda_barrio'
                ? 'Tipo de Activación Tienda de Barrio'
                : formulario.tipo_grupo === 'comercio'
                  ? 'Tipo de Activación Comercio'
                  : 'Tipo de Activación Transeúnte'}
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

        {requiereComercioGeneral && (
          <>
            <Text style={styles.label}>Tipo de Comercio</Text>
            <Picker
              selectedValue={formulario.tipo_comercio}
              onValueChange={(v) => setFormulario((prev) => ({
                ...prev,
                tipo_comercio: v,
              }))}
              style={styles.picker}
            >
              <Picker.Item label="Seleccionar..." value="" />
              {TIPOS_COMERCIO.map(item => (
                <Picker.Item key={item} label={item} value={item} />
              ))}
            </Picker>
          </>
        )}

        {/* `tipo_tienda` estaba duplicando el campo de tamaño; se oculta en la UI
            y se utiliza únicamente `tamano_tienda` para mantener un único valor. */}

        {requiereComercioGeneral && (
          <>
            <View style={styles.rubroTitleRow}>
              <Text style={styles.label}>Rubro *</Text>
              <TouchableOpacity onPress={() => setGuiaRubrosVisible(true)} style={styles.guiaRubroButton}>
                <Text style={styles.guiaRubroButtonText}>Ver guía</Text>
              </TouchableOpacity>
            </View>
            <Picker selectedValue={formulario.rubro_comercio} onValueChange={(v) => actualizarCampo('rubro_comercio', v)} style={styles.picker}>
              <Picker.Item label="Seleccionar..." value="" />
              {RUBROS_COMERCIO.map((item) => <Picker.Item key={item} label={item} value={item} />)}
            </Picker>
            <Text style={styles.label}>¿Comercio fuera del mercado?</Text>
            <Picker selectedValue={formulario.comercio_fuera_mercado} onValueChange={(v) => actualizarCampo('comercio_fuera_mercado', v)} style={styles.picker}>
              <Picker.Item label="Seleccionar..." value={null} />
              <Picker.Item label="Sí" value={true} />
              <Picker.Item label="No" value={false} />
            </Picker>
          </>
        )}

        {zonasDisponibles.length > 1 && (
          <>
            <Text style={styles.label}>Zona de Activación</Text>
            <Picker
              selectedValue={formulario.zona_activacion}
              onValueChange={(v) => actualizarCampo('zona_activacion', v)}
              style={styles.picker}
              enabled={!!formulario.ciudad_activacion}
            >
              <Picker.Item label="Seleccionar..." value="" />
              {zonasDisponibles.map((zona) => <Picker.Item key={zona} label={zona} value={zona} />)}
            </Picker>
          </>
        )}
        <Text style={styles.label}>Plaza asignada</Text>
        {plazasTemporales.length === 0 ? (
          <View style={styles.fixedPlaza}>
            <Text style={styles.plazaTag}>Base</Text>
            <Text style={styles.fixedPlazaText}>{usuario.plaza || 'No especificada'}</Text>
          </View>
        ) : (
          <Picker selectedValue={plazaSeleccionada} onValueChange={onPlazaChange} style={styles.picker}>
            <Picker.Item label={`Base · ${usuario.plaza || 'No especificada'}`} value="base" />
            {plazasTemporales.map((plaza) => (
              <Picker.Item key={plaza.id} label={`Temporal · ${plaza.nombre}`} value={`temporal:${plaza.id}`} color={colors.warning} />
            ))}
          </Picker>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Datos del cliente</Text>
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
          value={formulario.telefono_cliente}
          onChangeText={(v) => actualizarCampo('telefono_cliente', v.replace(/\D/g, '').slice(0, 8))}
        />

        <Text style={styles.label}>Correo Electrónico</Text>
        <TextInput
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
          value={formulario.email_cliente}
          onChangeText={(v) => actualizarCampo('email_cliente', v)}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Checklist de activación</Text>
        {['descargo_app', 'registro', 'cash_in', 'cash_out', 'p2p', 'qr_fisico', 'respaldo'].map(key => (
          <View key={key} style={styles.switchRow}>
            <Text style={styles.switchLabel}>{key.replace(/_/g, ' ').toUpperCase()}</Text>
            <Switch
              value={formulario[key]}
              onValueChange={(v) => actualizarCampo(key, v)}
              trackColor={{ false: colors.inputBorder, true: colors.primary }}
            />
          </View>
        ))}

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>¿HUBO ERROR?</Text>
          <Switch
            value={formulario.hubo_error}
            onValueChange={(v) => setFormulario((prev) => ({ ...prev, hubo_error: v, tipo_error: v ? prev.tipo_error : '', descripcion_error: v ? prev.descripcion_error : '' }))}
            trackColor={{ false: colors.inputBorder, true: colors.warning }}
          />
        </View>

        {formulario.hubo_error && (
          <>
            <Text style={styles.label}>Tipo de error</Text>
            <Picker selectedValue={formulario.tipo_error} onValueChange={(v) => setFormulario((prev) => ({ ...prev, tipo_error: v, descripcion_error: v === 'Otro' ? prev.descripcion_error : '' }))} style={styles.picker}>
              <Picker.Item label="Seleccionar..." value="" />
              {TIPOS_ERROR.map((item) => <Picker.Item key={item} label={item} value={item} />)}
            </Picker>
            <Text style={styles.label}>Descripción del error</Text>
            <TextInput
              value={formulario.descripcion_error}
              onChangeText={(v) => actualizarCampo('descripcion_error', v)}
              style={styles.input}
            />
          </>
        )}
      </View>

      {requiereFotos ? (
        <View style={styles.card}>
          <Text style={styles.evidenceSectionTitle}>📸 Evidencias ({fotosCapturadas}/2)</Text>
          <View style={styles.evidenceButtonsRow}>
            <TouchableOpacity
              onPress={() => abrirEvidencia(fotoPrincipalUri, setFotoPrincipal, 'foto_url', 'Activación')}
              style={[styles.evidenceButton, fotoPrincipalUri && styles.evidenceButtonCaptured]}
              activeOpacity={0.8}
            >
              <Text style={[styles.evidenceButtonIcon, fotoPrincipalUri && styles.evidenceButtonTextCaptured]}>{fotoPrincipalUri ? '✓' : '📷'}</Text>
              <Text style={[styles.evidenceButtonText, fotoPrincipalUri && styles.evidenceButtonTextCaptured]}>Activación</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => abrirEvidencia(fotoCashInUri, setFotoCashIn, 'foto_cash_in', 'Cash-In')}
              style={[styles.evidenceButton, fotoCashInUri && styles.evidenceButtonCaptured]}
              activeOpacity={0.8}
            >
              <Text style={[styles.evidenceButtonIcon, fotoCashInUri && styles.evidenceButtonTextCaptured]}>{fotoCashInUri ? '✓' : '💳'}</Text>
              <Text style={[styles.evidenceButtonText, fotoCashInUri && styles.evidenceButtonTextCaptured]}>Cash-In</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <Modal visible={!!evidenciaPreview} transparent animationType="fade" onRequestClose={() => setEvidenciaPreview(null)}>
        <View style={styles.previewBackdrop}>
          <View style={styles.previewPanel}>
            <Text style={styles.previewTitle}>{evidenciaPreview?.label}</Text>
            {!!evidenciaPreview?.uri && <Image source={{ uri: evidenciaPreview.uri }} style={styles.previewImage} resizeMode="contain" />}
            <View style={styles.previewActions}>
              <TouchableOpacity style={styles.previewActionPrimary} onPress={cambiarEvidencia}><Text style={styles.previewActionPrimaryText}>Cambiar foto</Text></TouchableOpacity>
              <TouchableOpacity style={styles.previewActionDanger} onPress={eliminarEvidencia}><Text style={styles.previewActionDangerText}>Eliminar foto</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.previewClose} onPress={() => setEvidenciaPreview(null)}><Text style={styles.previewCloseText}>Cerrar</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={guiaRubrosVisible} transparent animationType="slide" onRequestClose={() => setGuiaRubrosVisible(false)}>
        <View style={styles.previewBackdrop}>
          <View style={styles.guiaRubrosPanel}>
            <Text style={styles.previewTitle}>Guía de Rubros</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Image
                source={require('../assets/comercio.png')}
                style={[styles.guiaImagen, { height: guiaRubrosImageHeight }]}
                resizeMode="contain"
              />
              {GUIA_RUBROS.map(([titulo, referencia]) => (
                <View key={titulo} style={styles.guiaRubroItem}>
                  <Text style={styles.guiaRubroTitle}>{titulo}</Text>
                  <Text style={styles.guiaRubroText}>{referencia}</Text>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.previewClose} onPress={() => setGuiaRubrosVisible(false)}>
              <Text style={styles.previewCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {!!estadoGuardado && (
        <View style={styles.saveStatus}>
          {guardando && <ActivityIndicator size="small" color={colors.primary} />}
          <Text style={styles.saveStatusText}>{estadoGuardado}</Text>
        </View>
      )}
      <View style={styles.botonesRow}>
        <TouchableOpacity
          onPress={guardarFormulario}
          disabled={guardando}
          style={[styles.botonMini, { backgroundColor: colors.primary, ...botonShadow }, guardando && styles.botonDisabled]}
          activeOpacity={0.85}
        >
          <Text style={styles.botonTextoMini}>{guardando ? 'Guardando…' : 'Guardar Activación'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    marginTop: spacing.xs,
    backgroundColor: colors.background,
  },
  containerMobile: {
    paddingHorizontal: spacing.sm,
  },
  heroCard: {
    backgroundColor: colors.headerBg,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#08131F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 5,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  badgePrimary: {
    backgroundColor: 'rgba(23, 105, 255, 0.3)',
  },
  badgeAccent: {
    backgroundColor: 'rgba(255, 138, 0, 0.28)',
  },
  badgeNeutral: {
    backgroundColor: 'rgba(182, 198, 214, 0.24)',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
    shadowColor: '#0D243A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  compactCard: {
    paddingVertical: spacing.sm,
  },
  titulo: {
    fontSize: fontSizes.xlarge,
    fontWeight: '700',
    marginBottom: 2,
    color: colors.headerText,
  },
  subtitulo: {
    fontSize: fontSizes.small,
    fontWeight: '500',
    marginBottom: spacing.xs,
    color: '#CDDBEA',
  },
  sectionTitle: {
    fontSize: fontSizes.large,
    fontWeight: '700',
    marginBottom: spacing.xs,
    color: colors.primaryDark,
  },
  label: {
    fontSize: fontSizes.medium,
    marginTop: spacing.xs + 2,
    marginBottom: spacing.xs,
    color: colors.text,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: fontSizes.medium,
  },
  picker: {
    backgroundColor: colors.inputBackground,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    minHeight: 48,
  },
  gpsCityBox: {
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    padding: spacing.sm,
  },
  gpsCityText: {
    color: colors.text,
    fontSize: fontSizes.small,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  gpsButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsButtonText: {
    color: '#FFFFFF',
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  locationStatus: {
    color: colors.primaryDark,
    fontSize: fontSizes.small,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  locationSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  fixedPlaza: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  plazaTag: {
    color: colors.primary,
    fontSize: fontSizes.small,
    fontWeight: '700',
    marginRight: spacing.sm,
  },
  fixedPlazaText: {
    flex: 1,
    color: colors.text,
    fontSize: fontSizes.small,
    fontWeight: '600',
  },
  helperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  helperLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    fontWeight: '600',
  },
  helperValue: {
    color: colors.text,
    fontSize: fontSizes.small,
    fontWeight: '700',
    maxWidth: '60%',
    textAlign: 'right',
  },
  guiaImagen: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: spacing.xs,
    minHeight: 48,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  switchLabel: {
    color: colors.text,
    fontSize: fontSizes.small,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  botonesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  botonMini: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minWidth: 130,
  },
  botonSecundario: {
    marginLeft: spacing.sm,
  },
  botonTextoMini: {
    color: '#FFFFFF',
    fontSize: fontSizes.medium,
    fontWeight: '700',
    textAlign: 'center',
  },
  imagenMiniatura: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  statusSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  statusSummaryItem: {
    flexGrow: 1,
    minWidth: 88,
    marginRight: spacing.xs,
  },
  statusSummaryLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  statusSummaryValue: {
    color: colors.text,
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  statusOk: { color: colors.success },
  statusPending: { color: colors.warning },
  missingHint: {
    width: '100%',
    color: colors.danger,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  evidenceSectionTitle: {
    color: colors.primaryDark,
    fontSize: fontSizes.medium,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  evidenceButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  evidenceButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginRight: spacing.xs,
  },
  evidenceButtonCaptured: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  evidenceButtonIcon: {
    color: colors.textMuted,
    fontSize: fontSizes.medium,
    marginRight: spacing.xs,
  },
  evidenceButtonText: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  evidenceButtonTextCaptured: {
    color: '#FFFFFF',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  previewPanel: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
  },
  previewTitle: {
    color: colors.text,
    fontSize: fontSizes.large,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  previewImage: {
    width: '100%',
    height: 360,
    maxHeight: '60%',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  previewActions: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  previewActionPrimary: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    marginRight: spacing.xs,
  },
  previewActionPrimaryText: {
    color: '#FFFFFF',
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  previewActionDanger: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    marginLeft: spacing.xs,
  },
  previewActionDangerText: {
    color: colors.danger,
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  previewClose: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  previewCloseText: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    fontWeight: '600',
  },
  rubroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  guiaRubroButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  guiaRubroButtonText: {
    color: colors.primary,
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  guiaRubrosPanel: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
  },
  guiaRubroItem: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  guiaRubroTitle: {
    color: colors.primaryDark,
    fontSize: fontSizes.small,
    fontWeight: '800',
    marginBottom: 3,
  },
  guiaRubroText: {
    color: colors.text,
    fontSize: fontSizes.small,
    lineHeight: 19,
  },
  saveStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    marginTop: spacing.sm,
  },
  saveStatusText: {
    color: colors.text,
    fontSize: fontSizes.small,
    fontWeight: '600',
    marginLeft: spacing.xs,
    textAlign: 'center',
  },
  saveDoneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  saveDoneTitle: {
    color: colors.primaryDark,
    fontSize: fontSizes.large,
    fontWeight: '700',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  saveDoneText: {
    color: colors.text,
    fontSize: fontSizes.medium,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  saveDoneActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saveDoneButton: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  saveDoneButtonSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.primary,
    marginLeft: spacing.sm,
  },
  saveDoneButtonSecondaryText: {
    color: colors.primary,
    fontSize: fontSizes.medium,
    fontWeight: '700',
    textAlign: 'center',
  },
  botonDisabled: {
    opacity: 0.6,
  },
});
