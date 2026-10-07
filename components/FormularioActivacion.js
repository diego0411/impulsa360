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
  AppState,
  Modal,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';
import { guardarFormularioLocal } from '../lib/storage';
import { secureLocalStorage } from '../lib/secureLocalStorage';
import { esFotoPendientePersistente, prepararImagenPersistente } from '../lib/upload';
import { normalizarNombreVisible } from '../lib/identity';
import { deduplicarPlazasPorEtiqueta, etiquetaPlaza, tienePlazaValida } from '../lib/plazas';
import { withTimeout } from '../lib/asyncTimeout';
import { requiereValidacionReactivacion, validarElegibilidadReactivacion } from '../lib/elegibilidadReactivacion';
import { resolverReglaFotografias } from '../lib/reglasFotografias';
import { enmascararMarcaVisible } from '../lib/brandMask';
import { colors, spacing, fontSizes, radius, shadow } from '../styles/theme';
import CameraEvidencia from './CameraEvidencia';
import { registrarErrorFoto } from '../lib/photoDiagnostics';
import { setEdicionActiva } from '../lib/edicionActiva';
import { photoSizeBucket, recordEvent } from '../lib/telemetry';
import { liberarFotoEnProceso, marcarFotoEnProceso } from '../lib/upload';

const DEVICE_INFO = `react-native-${Platform.OS}`;
const GPS_TIMEOUT_MS = 15000;
const CONOCIDA_TIMEOUT_MS = 3000;
const UBICACION_CONOCIDA_MAX_MS = 120000;
const PRECISION_MAXIMA_METROS = 200;
const BORRADOR_DEBOUNCE_MS = 700;
const GALLERY_TIMEOUT_MS = 30000;
const PHOTO_FILE_TIMEOUT_MS = 12000;
const borradorKey = (usuarioId) => (usuarioId ? `borrador_formulario_${usuarioId}` : null);
const MENSAJE_GPS_OBLIGATORIO = 'No se pudo obtener la ubicación actual. Activa el GPS, revisa el permiso de ubicación e intenta guardar nuevamente.';
const formDebug = (...args) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[form]', ...args);
  }
};
const esFotoLocal = (value) => typeof value === 'string' && /^file:\/\//i.test(value);
const textoSeguro = (value) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

// Normaliza un borrador restaurado para que nunca rompa render/validación:
// todo texto se coerce a string y las fotos a string|null. No cambia reglas.
const normalizarCamposBorrador = (campos = {}) => {
  const base = campos && typeof campos === 'object' ? campos : {};
  return {
    ...base,
    nombres_cliente: textoSeguro(base.nombres_cliente),
    apellidos_cliente: textoSeguro(base.apellidos_cliente),
    ci_cliente: textoSeguro(base.ci_cliente),
    telefono_cliente: textoSeguro(base.telefono_cliente),
    email_cliente: textoSeguro(base.email_cliente),
    rubro_comercio_otro: textoSeguro(base.rubro_comercio_otro),
    descripcion_error: textoSeguro(base.descripcion_error),
    tipo_error: textoSeguro(base.tipo_error),
    tipo_activacion: textoSeguro(base.tipo_activacion),
    tipo_grupo: textoSeguro(base.tipo_grupo),
    ciudad_activacion: textoSeguro(base.ciudad_activacion),
    zona_activacion: textoSeguro(base.zona_activacion),
    foto_url: typeof base.foto_url === 'string' ? base.foto_url : '',
    foto_cash_in: typeof base.foto_cash_in === 'string' ? base.foto_cash_in : '',
  };
};

const validarFotoLocalDisponible = async (uri, label) => {
  if (!esFotoLocal(uri)) return null;
  if (!esFotoPendientePersistente(uri)) return `La foto de ${label} no está en almacenamiento persistente. Tómala nuevamente.`;
  const info = await FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
  if (!info?.exists) return `La foto de ${label} ya no está disponible. Tómala nuevamente.`;
  if (typeof info.size === 'number' && info.size <= 0) return `La foto de ${label} está vacía. Tómala nuevamente.`;
  return null;
};
const optionalTextOrNull = (value) => {
  if (typeof value === 'string' && value.trim() === '') return null;
  return value ?? null;
};
const tieneCoordenadasValidas = (data = {}) => (
  Number.isFinite(data.latitud) && Number.isFinite(data.longitud)
);
const esActivacionTranseunte = (tipoActivacion) =>
  String(tipoActivacion || '').toLowerCase() === 'transeunte';

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
const RUBROS_COMERCIO = [
  'Comercio',
  'Servicios Profesionales',
  'Servicio de Comida',
  'Servicio de Transporte',
  'Manufactura Artesanal',
  'Ambulantes',
  'Servicios Personales',
  'Reparación de Vehículos',
  'Otro',
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
  distrito_gps: '',
  region_gps: '',
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
  const [camaraEvidencia, setCamaraEvidencia] = useState(null);
  const [estadoGuardado, setEstadoGuardado] = useState('');
  const [mensajeGuardado, setMensajeGuardado] = useState('');
  const [activacionGuardada, setActivacionGuardada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borradorListoUsuario, setBorradorListoUsuario] = useState(null);
  const [usuarioFormularioId, setUsuarioFormularioId] = useState(usuario?.id || null);
  const [borradorResetToken, setBorradorResetToken] = useState(0);
  const guardandoRef = useRef(false);
  const gpsSolicitudRef = useRef(null);
  const fotosPersistentesRef = useRef({});
  const galeriaOperacionRef = useRef(null);
  const mountedRef = useRef(true);
  const ciudadManualRef = useRef(false);
  const borradorTimerRef = useRef(null);
  const borradorRestauradoRef = useRef(null);
  const restaurandoBorradorRef = useRef(false);
  const borradorColaRef = useRef(Promise.resolve());
  const borradorGeneracionRef = useRef(0);
  const borradorPendienteRef = useRef(null);
  const borradorBloqueadoRef = useRef(false);
  const borradorFirmaBloqueadaRef = useRef(null);
  const borradorBaselineListaRef = useRef(true);
  const borradoresUltimosRef = useRef({});
  const borradorRestauracionIdRef = useRef(0);
  const borradorUsuariosListosRef = useRef({});
  const borradorFirmasInicioRef = useRef({});
  const borradorPersistenciaErrorRef = useRef(null);
  const borradorEscribiendoRef = useRef(false);
  const borradorCoalescidoRef = useRef(null);
  const borradorFirmaPersistidaRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const formularioSesionRef = useRef(0);
  const usuarioFormularioIdRef = useRef(usuarioFormularioId);
  usuarioFormularioIdRef.current = usuarioFormularioId;
  const usuarioActualIdRef = useRef(usuario?.id || null);
  usuarioActualIdRef.current = usuario?.id || null;
  const [detectandoCiudad, setDetectandoCiudad] = useState(isConnected !== false);
  const { width, height } = useWindowDimensions();
  const guiaRubrosImageHeight = Math.max(150, Math.min((width - spacing.md * 4) / 1.5, height * 0.38));
  const botonShadow = Platform.OS === 'web'
    ? { boxShadow: '0px 2px 6px rgba(0,0,0,0.3)' }
    : shadow.base;

  const actualizarCampo = (campo, valor) => {
    setFormulario(prev => ({ ...prev, [campo]: valor }));
  };

  const esSesionFormularioActual = useCallback((sesion, propietarioId) => (
    mountedRef.current
    && sesion === formularioSesionRef.current
    && propietarioId === usuarioFormularioIdRef.current
  ), []);

  const crearSnapshotBorrador = useCallback((usuarioId, campos, principal, cashIn, persistentes = fotosPersistentesRef.current || {}) => ({
    usuario_id: usuarioId,
    updatedAt: new Date().toISOString(),
    campos,
    fotos: {
      fotoPrincipal: principal,
      fotoCashIn: cashIn,
      fotosPersistentes: persistentes,
    },
  }), []);

  const firmaSnapshotBorrador = useCallback((snapshot) => JSON.stringify({
    usuario_id: snapshot?.usuario_id || null,
    campos: snapshot?.campos || null,
    fotos: snapshot?.fotos || null,
  }), []);

  const encolarBorrador = useCallback((snapshot, generacion = borradorGeneracionRef.current, forzar = false) => {
    if (!snapshot?.usuario_id) return borradorColaRef.current;
    // Coalescencia: si ya hay una escritura en vuelo, conserva solo el
    // snapshot más nuevo en lugar de encolar indefinidamente.
    if (borradorEscribiendoRef.current && !forzar) {
      borradorCoalescidoRef.current = { snapshot, generacion };
      return borradorColaRef.current;
    }
    const key = borradorKey(snapshot.usuario_id);
    borradorColaRef.current = borradorColaRef.current
      .catch(() => {})
      .then(async () => {
        if (!forzar && (generacion !== borradorGeneracionRef.current || borradorBloqueadoRef.current)) return;
        let actual = snapshot;
        let genActual = generacion;
        // Si llegó un snapshot más nuevo mientras se esperaba turno, usarlo.
        const coalescidoPrevio = borradorCoalescidoRef.current;
        if (coalescidoPrevio && !forzar) {
          actual = coalescidoPrevio.snapshot;
          genActual = coalescidoPrevio.generacion;
          borradorCoalescidoRef.current = null;
        }
        if (!forzar && genActual !== borradorGeneracionRef.current) return;
        // No persistir si la firma no cambió respecto a lo ya guardado.
        try {
          const firma = firmaSnapshotBorrador(actual);
          if (!forzar && firma === borradorFirmaPersistidaRef.current) return;
          borradorEscribiendoRef.current = true;
          await secureLocalStorage.setItem(key, JSON.stringify(actual));
          borradorFirmaPersistidaRef.current = firma;
          borradorPersistenciaErrorRef.current = null;
          recordEvent('draft_write_ok', { app_state: 'active', phase: 'draft' }).catch(() => {});
        } catch (error) {
          borradorPersistenciaErrorRef.current = error;
          recordEvent('draft_write_error', { app_state: 'active', phase: 'draft', error_category: 'draft_write' }).catch(() => {});
        } finally {
          borradorEscribiendoRef.current = false;
        }
      });
    return borradorColaRef.current;
  }, [firmaSnapshotBorrador]);

  const flushBorradorActual = useCallback(() => {
    const propietarioId = usuarioFormularioIdRef.current;
    if (
      !propietarioId
      || propietarioId !== usuarioActualIdRef.current
      || borradorBloqueadoRef.current
    ) return borradorColaRef.current;

    const snapshot = borradoresUltimosRef.current[propietarioId];
    if (!snapshot || snapshot.usuario_id !== propietarioId) return borradorColaRef.current;
    const firmaInicial = borradorFirmasInicioRef.current[propietarioId];
    const tieneCambios = firmaSnapshotBorrador(snapshot) !== firmaInicial;
    if (
      (restaurandoBorradorRef.current || !borradorUsuariosListosRef.current[propietarioId])
      && !tieneCambios
    ) return borradorColaRef.current;
    if (borradorTimerRef.current) {
      globalThis.clearTimeout(borradorTimerRef.current);
      borradorTimerRef.current = null;
    }
    borradorPendienteRef.current = null;
    return encolarBorrador(snapshot, borradorGeneracionRef.current);
  }, [encolarBorrador, firmaSnapshotBorrador]);

  const eliminarBorrador = useCallback(async (propietarioId) => {
    const key = borradorKey(propietarioId);
    if (!key) return;
    borradorGeneracionRef.current += 1;
    borradorBloqueadoRef.current = true;
    borradorFirmaBloqueadaRef.current = null;
    borradorBaselineListaRef.current = false;
    borradorFirmaPersistidaRef.current = null;
    borradorCoalescidoRef.current = null;
    borradorEscribiendoRef.current = false;
    borradorPendienteRef.current = null;
    if (borradorTimerRef.current) {
      globalThis.clearTimeout(borradorTimerRef.current);
      borradorTimerRef.current = null;
    }
    borradorColaRef.current = borradorColaRef.current
      .catch(() => {})
      .then(() => secureLocalStorage.removeItem(key));
    await borradorColaRef.current;
  }, []);

  const limpiarFormulario = useCallback(async () => {
    const formularioLimpio = {
      ...formularioInicial,
      id: '',
      impulsador: normalizarNombreVisible(usuario?.nombre || ''),
      fecha_activacion: new Date().toISOString().split('T')[0],
    };
    const propietarioId = usuarioFormularioId;
    formularioSesionRef.current += 1;
    gpsSolicitudRef.current = null;
    const eliminacion = eliminarBorrador(propietarioId);
    // Borra solo archivos temporales propios (fotos persistentes del borrador).
    const uris = new Set([
      fotoPrincipal,
      fotoCashIn,
      formulario.foto_url,
      formulario.foto_cash_in,
      ...Object.values(fotosPersistentesRef.current || {}),
    ]);
    // Best-effort: un fallo eliminando un archivo nunca rechaza ni crashea.
    await Promise.all([...uris].map(async (uri) => {
      try {
        if (typeof uri === 'string' && /^file:\/\//i.test(uri)) {
          await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        }
      } catch {
        // limpieza best-effort: se ignora el fallo individual
      }
    }));
    await eliminacion;
    // Permite restaurar un borrador futuro; el effect de restore no se
    // re-ejecuta solo por resetear el ref, así que no restaura de inmediato.
    borradorRestauradoRef.current = null;
    fotosPersistentesRef.current = {};
    ciudadManualRef.current = false;
    if (borradorTimerRef.current) globalThis.clearTimeout(borradorTimerRef.current);
    if (!mountedRef.current) return;
    setFormulario(formularioLimpio);
    setFotoPrincipal(null);
    setFotoCashIn(null);
    setEvidenciaPreview(null);
    setActivacionGuardada(false);
    setEstadoGuardado('');
    setMensajeGuardado('');
    setGuardando(false);
    guardandoRef.current = false;
    gpsSolicitudRef.current = null;
    setBorradorResetToken((actual) => actual + 1);
  }, [eliminarBorrador, fotoPrincipal, fotoCashIn, formulario.foto_url, formulario.foto_cash_in, usuario?.nombre, usuarioFormularioId]);

  const confirmarBorrarFormulario = useCallback(() => {
    Alert.alert(
      'Borrar formulario',
      'Se descartarán los datos y fotos no guardadas de este formulario. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: () => { limpiarFormulario(); } },
      ]
    );
  }, [limpiarFormulario]);

  const usuarioIdBorrador = usuarioFormularioId;
  const snapshotBorradorActual = crearSnapshotBorrador(
    usuarioIdBorrador,
    formulario,
    fotoPrincipal,
    fotoCashIn,
  );
  if (usuarioIdBorrador) borradoresUltimosRef.current[usuarioIdBorrador] = snapshotBorradorActual;

  // Señal de edición activa (boolean barato, sin persistencia por tecla).
  useEffect(() => {
    if (activacionGuardada || !usuarioIdBorrador) {
      setEdicionActiva(false);
      return;
    }
    const firmaInicial = borradorFirmasInicioRef.current[usuarioIdBorrador];
    const firmaActual = firmaSnapshotBorrador(snapshotBorradorActual);
    const hayEdicion = (firmaInicial && firmaActual !== firmaInicial) || !!fotoPrincipal || !!fotoCashIn;
    setEdicionActiva(hayEdicion === true);
    if (hayEdicion) {
      recordEvent('form_edit', { app_state: 'active', phase: 'form' }).catch(() => {});
    }
  }, [activacionGuardada, firmaSnapshotBorrador, fotoCashIn, fotoPrincipal, snapshotBorradorActual, usuarioIdBorrador]);

  useEffect(() => () => {
    mountedRef.current = false;
    gpsSolicitudRef.current = null;
    setEdicionActiva(false);
    if (borradorTimerRef.current) globalThis.clearTimeout(borradorTimerRef.current);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState === 'active' && (nextState === 'background' || nextState === 'inactive')) {
        flushBorradorActual();
      }
    });
    return () => sub.remove();
  }, [flushBorradorActual]);

  useEffect(() => {
    const nuevoUsuarioId = usuario?.id || null;
    if (nuevoUsuarioId === usuarioFormularioId) return;

    const usuarioAnteriorId = usuarioFormularioId;
    const snapshotAnterior = usuarioAnteriorId ? borradoresUltimosRef.current[usuarioAnteriorId] : null;
    if (borradorTimerRef.current) {
      globalThis.clearTimeout(borradorTimerRef.current);
      borradorTimerRef.current = null;
    }
    borradorPendienteRef.current = null;
    const generacionTransicion = borradorGeneracionRef.current + 1;
    borradorGeneracionRef.current = generacionTransicion;
    if (snapshotAnterior && !borradorBloqueadoRef.current) {
      // El snapshot conserva el owner original y su clave se calcula antes de
      // preparar el formulario del usuario entrante.
      encolarBorrador(snapshotAnterior, generacionTransicion, true);
    }

    formularioSesionRef.current += 1;
    gpsSolicitudRef.current = null;
    borradorBloqueadoRef.current = true;
    borradorFirmaBloqueadaRef.current = null;
    borradorBaselineListaRef.current = false;
    borradorRestauracionIdRef.current += 1;
    borradorRestauradoRef.current = null;
    restaurandoBorradorRef.current = false;
    fotosPersistentesRef.current = {};
    ciudadManualRef.current = false;
    setBorradorListoUsuario(null);
    setFormulario({
      ...formularioInicial,
      id: '',
      impulsador: normalizarNombreVisible(usuario?.nombre || ''),
      fecha_activacion: new Date().toISOString().split('T')[0],
    });
    setFotoPrincipal(null);
    setFotoCashIn(null);
    setEvidenciaPreview(null);
    setCamaraEvidencia(null);
    setActivacionGuardada(false);
    setEstadoGuardado('');
    setMensajeGuardado('');
    setGuardando(false);
    guardandoRef.current = false;
    setUsuarioFormularioId(nuevoUsuarioId);
    setBorradorResetToken((actual) => actual + 1);
  }, [encolarBorrador, usuario?.id, usuario?.nombre, usuarioFormularioId]);

  useEffect(() => {
    const usuarioId = usuarioFormularioId;
    return () => {
      const snapshot = usuarioId ? borradoresUltimosRef.current[usuarioId] : null;
      const firmaInicial = usuarioId ? borradorFirmasInicioRef.current[usuarioId] : null;
      const tieneCambios = snapshot && firmaSnapshotBorrador(snapshot) !== firmaInicial;
      if (snapshot && !borradorBloqueadoRef.current && (borradorUsuariosListosRef.current[usuarioId] || tieneCambios)) {
        encolarBorrador(snapshot, borradorGeneracionRef.current);
      }
    };
  }, [encolarBorrador, firmaSnapshotBorrador, usuarioFormularioId]);

  useEffect(() => {
    if (!borradorResetToken || !usuarioFormularioId) return;
    const snapshot = borradoresUltimosRef.current[usuarioFormularioId];
    if (!snapshot) return;
    borradorFirmaBloqueadaRef.current = firmaSnapshotBorrador(snapshot);
    borradorBaselineListaRef.current = true;
  }, [borradorResetToken, firmaSnapshotBorrador, usuarioFormularioId]);

  // Restaurar borrador del usuario actual al volver al formulario.
  useEffect(() => {
    const usuarioId = usuario?.id;
    if (!usuarioId || usuarioId !== usuarioFormularioId || activacionGuardada) return;
    if (borradorRestauradoRef.current === usuarioId) return;
    borradorRestauradoRef.current = usuarioId;
    const restauracionId = ++borradorRestauracionIdRef.current;
    const firmaInicial = firmaSnapshotBorrador(borradoresUltimosRef.current[usuarioId]);
    borradorFirmasInicioRef.current[usuarioId] = firmaInicial;
    borradorUsuariosListosRef.current[usuarioId] = false;
    restaurandoBorradorRef.current = true;
    let cancelado = false;
    (async () => {
      try {
        const raw = await secureLocalStorage.getItem(borradorKey(usuarioId));
        const borrador = raw ? JSON.parse(raw) : null;
        const firmaActual = firmaSnapshotBorrador(borradoresUltimosRef.current[usuarioId]);
        if (cancelado || !mountedRef.current || restauracionId !== borradorRestauracionIdRef.current) return;
        if (firmaActual !== firmaInicial) return;
        if (!borrador || borrador.usuario_id !== usuarioId || !borrador.campos) return;
        const fotos = borrador.fotos || {};
        const validarFotoRestaurada = async (uri) => {
          if (!esFotoLocal(uri)) return uri || null;
          const info = await FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
          return info?.exists && (!Number.isFinite(info.size) || info.size > 0) ? uri : null;
        };
        const [principal, cashIn] = await Promise.all([
          validarFotoRestaurada(fotos.fotoPrincipal),
          validarFotoRestaurada(fotos.fotoCashIn),
        ]);
        if (cancelado || !mountedRef.current || restauracionId !== borradorRestauracionIdRef.current) return;
        if (firmaSnapshotBorrador(borradoresUltimosRef.current[usuarioId]) !== firmaInicial) return;
        const fotosPersistentes = {};
        for (const [campo, uri] of Object.entries(fotos.fotosPersistentes || {})) {
          const uriValida = await validarFotoRestaurada(uri);
          if (uriValida) fotosPersistentes[campo] = uriValida;
        }
        if (cancelado || !mountedRef.current || restauracionId !== borradorRestauracionIdRef.current) return;
        if (firmaSnapshotBorrador(borradoresUltimosRef.current[usuarioId]) !== firmaInicial) return;
        fotosPersistentesRef.current = fotosPersistentes;
        const camposNormalizados = normalizarCamposBorrador(borrador.campos);
        setFormulario({
          ...formularioInicial,
          ...camposNormalizados,
          foto_url: principal ? camposNormalizados.foto_url : '',
          foto_cash_in: cashIn ? camposNormalizados.foto_cash_in : '',
        });
        setFotoPrincipal(principal);
        setFotoCashIn(cashIn);
      } catch {
        // borrador inválido: se continúa con formulario limpio
      } finally {
        restaurandoBorradorRef.current = false;
        if (!cancelado && mountedRef.current && restauracionId === borradorRestauracionIdRef.current) {
          borradorUsuariosListosRef.current[usuarioId] = true;
          setBorradorListoUsuario(usuarioId);
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [usuario?.id, usuarioFormularioId, activacionGuardada, firmaSnapshotBorrador]);

  // Autosave con debounce: solo borrador local, nunca sincroniza ni crea registros.
  useEffect(() => {
    const usuarioId = usuario?.id;
    if (!usuarioId || usuarioId !== usuarioFormularioId || borradorListoUsuario !== usuarioId || activacionGuardada || restaurandoBorradorRef.current) return;
    const snapshot = crearSnapshotBorrador(usuarioId, formulario, fotoPrincipal, fotoCashIn);
    const firma = firmaSnapshotBorrador(snapshot);
    if (borradorBloqueadoRef.current) {
      if (!borradorBaselineListaRef.current) return;
      if (firma === borradorFirmaBloqueadaRef.current) return;
      borradorBloqueadoRef.current = false;
      borradorFirmaBloqueadaRef.current = null;
      borradorGeneracionRef.current += 1;
    }
    if (borradorTimerRef.current) {
      globalThis.clearTimeout(borradorTimerRef.current);
      borradorTimerRef.current = null;
    }
    const pendiente = { snapshot, generacion: borradorGeneracionRef.current };
    borradorPendienteRef.current = pendiente;
    borradorTimerRef.current = globalThis.setTimeout(() => {
      borradorTimerRef.current = null;
      if (borradorPendienteRef.current === pendiente) borradorPendienteRef.current = null;
      encolarBorrador(pendiente.snapshot, pendiente.generacion);
    }, BORRADOR_DEBOUNCE_MS);
  }, [formulario, fotoPrincipal, fotoCashIn, usuario?.id, usuarioFormularioId, activacionGuardada, borradorListoUsuario, crearSnapshotBorrador, encolarBorrador, firmaSnapshotBorrador]);

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
  // Matriz definitiva de fotografías (lib/reglasFotografias.js).
  const reglaFotos = resolverReglaFotografias(formulario.tipo_grupo, formulario.tipo_activacion);
  const requiereFotos = true;
  const requiereFotoPrincipal = reglaFotos.requiereEvidencia;
  const requiereCashIn = reglaFotos.requiereCashIn;
  const sinFotosObligatorias = !reglaFotos.requiereEvidencia && !reglaFotos.requiereCashIn;
  const totalFotosRequeridas = Number(requiereFotoPrincipal) + Number(requiereCashIn);
  const plazasTemporales = useMemo(
    () => Array.isArray(usuario?.plazas_temporales) ? usuario.plazas_temporales : [],
    [usuario?.plazas_temporales],
  );
  const plazasTemporalesVisibles = useMemo(
    () => deduplicarPlazasPorEtiqueta(plazasTemporales),
    [plazasTemporales],
  );
  const plazaBaseLabel = enmascararMarcaVisible(etiquetaPlaza(usuario?.plaza, 'No especificada'), usuario);
  const plazaBaseValor = tienePlazaValida(usuario?.plaza) ? usuario.plaza : null;
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

  const extraerUbicacionDerivada = (dir = {}) => ({
    distrito_gps: typeof dir.district === 'string' && dir.district.trim() ? dir.district.trim() : '',
    region_gps: typeof dir.region === 'string' && dir.region.trim() ? dir.region.trim() : '',
  });

  const detectarCiudadPorGps = useCallback(({ silent = false } = {}) => {
    if (Platform.OS === 'web') return Promise.resolve(null);
    if (gpsSolicitudRef.current) return gpsSolicitudRef.current;
    const sesionFormulario = formularioSesionRef.current;
    const propietarioFormulario = usuarioFormularioIdRef.current;

    let solicitud;
    solicitud = (async () => {
      if (esSesionFormularioActual(sesionFormulario, propietarioFormulario)) setDetectandoCiudad(true);
      try {
        const permiso = await Location.requestForegroundPermissionsAsync();
        if (!esSesionFormularioActual(sesionFormulario, propietarioFormulario)) return null;
        if (permiso.status !== 'granted') {
          if (!silent && esSesionFormularioActual(sesionFormulario, propietarioFormulario)) {
            Alert.alert('Ubicación desactivada', 'Activa el permiso de ubicación para detectar la ciudad automáticamente.');
          }
          return null;
        }

        let serviciosActivos = true;
        try {
          serviciosActivos = await withTimeout(
            Location.hasServicesEnabledAsync(),
            CONOCIDA_TIMEOUT_MS,
            'No se pudo verificar el GPS.'
          );
        } catch {
          serviciosActivos = true;
        }
        if (serviciosActivos === false) {
          if (!silent && esSesionFormularioActual(sesionFormulario, propietarioFormulario)) {
            Alert.alert('GPS desactivado', 'Activa los servicios de ubicación (GPS) del dispositivo e intenta nuevamente.');
          }
          return null;
        }

        // Estrategia escalonada (sin loops, una sola solicitud a la vez vía gpsSolicitudRef):
        // 1) última conocida reciente y precisa; 2) Balanced; 3) High solo si Balanced es imprecisa.
        const esUbicacionAceptable = (coords) => {
          if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) return false;
          return typeof coords.accuracy !== 'number' || coords.accuracy <= PRECISION_MAXIMA_METROS;
        };

        let coordenadas = null;
        try {
          const conocida = await withTimeout(
            Location.getLastKnownPositionAsync(),
            CONOCIDA_TIMEOUT_MS,
            'Ubicación conocida no disponible.'
          );
          const edadMs = Date.now() - (conocida?.timestamp || 0);
          if (esUbicacionAceptable(conocida?.coords) && edadMs <= UBICACION_CONOCIDA_MAX_MS) {
            coordenadas = conocida.coords;
          }
        } catch {
          // Sin ubicación conocida útil: se continúa con GPS en vivo.
        }

        if (!esUbicacionAceptable(coordenadas)) {
          const enVivo = await withTimeout(
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            GPS_TIMEOUT_MS,
            'La ubicación está tardando demasiado.'
          );
          coordenadas = enVivo?.coords || null;
          if (!esUbicacionAceptable(coordenadas)) {
            const precisa = await withTimeout(
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
              GPS_TIMEOUT_MS,
              'La ubicación está tardando demasiado.'
            );
            coordenadas = precisa?.coords || null;
            if (!esUbicacionAceptable(coordenadas)) {
              throw new Error('La ubicación es imprecisa. Intenta al aire libre con el GPS activado.');
            }
          }
        }
        const latitud = coordenadas?.latitude;
        const longitud = coordenadas?.longitude;
        if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
          throw new Error('La ubicación no devolvió coordenadas válidas.');
        }
        if (!esSesionFormularioActual(sesionFormulario, propietarioFormulario)) return null;
        const resultado = { latitud, longitud };
        setFormulario((prev) => ({ ...prev, ...resultado }));

        // Las coordenadas válidas liberan el flujo GPS. La ciudad y los datos
        // derivados se completan después sin bloquear ni invalidar el GPS.
        (async () => {
          let direccionGps = {};
          try {
            const geocoded = await withTimeout(
              Location.reverseGeocodeAsync({ latitude: latitud, longitude: longitud }),
              GPS_TIMEOUT_MS,
              'La ubicación está tardando demasiado.'
            );
            direccionGps = geocoded?.[0] || {};
          } catch (geocodeError) {
            console.warn('No se pudo resolver la ciudad por GPS:', geocodeError?.message || geocodeError);
          }
          if (!esSesionFormularioActual(sesionFormulario, propietarioFormulario)) return;

          const ciudadGps = resolverCiudadDesdeDireccion(direccionGps) || resolverCiudadKey(usuario?.plaza);
          const ubicacionDerivada = extraerUbicacionDerivada(direccionGps);
          if (!ciudadGps) {
            if (!silent) {
              Alert.alert(
                'Ciudad no detectada',
                'Se obtuvo tu ubicación, pero no pudimos identificar la ciudad automáticamente. Selecciónala manualmente.'
              );
            }
            setFormulario((prev) => ({ ...prev, ...ubicacionDerivada }));
            return;
          }

          setFormulario((prev) => {
            // No sobrescribir ciudad elegida manualmente por un GPS tardío.
            const ciudadFinal = ciudadManualRef.current && prev.ciudad_activacion
              ? prev.ciudad_activacion
              : ciudadGps;
            return {
              ...prev,
              ciudad_activacion: ciudadFinal,
              zona_activacion: prev.ciudad_activacion === ciudadFinal ? prev.zona_activacion : '',
              ...ubicacionDerivada,
            };
          });
        })().catch((geocodeError) => {
          console.warn('No se pudo completar la ubicación derivada:', geocodeError?.message || geocodeError);
        });
        return resultado;
      } catch (error) {
        console.warn('No se pudo detectar ciudad por GPS:', error?.message || error);
        if (!silent && esSesionFormularioActual(sesionFormulario, propietarioFormulario)) {
          Alert.alert('Error de ubicación', error?.message || 'No se pudo obtener la ubicación actual.');
        }
        return null;
      } finally {
        if (gpsSolicitudRef.current === solicitud) gpsSolicitudRef.current = null;
        if (esSesionFormularioActual(sesionFormulario, propietarioFormulario)) setDetectandoCiudad(false);
      }
    })();
    gpsSolicitudRef.current = solicitud;
    return solicitud;
  }, [esSesionFormularioActual, usuario?.plaza]);

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
    if (activacionGuardada || tieneCoordenadasValidas(formulario)) return;
    detectarCiudadPorGps({ silent: true });
  }, [activacionGuardada, detectarCiudadPorGps, formulario.latitud, formulario.longitud]);

  const procesarFotoCapturada = async (uri, setter, fieldName) => {
    const sesionFormulario = formularioSesionRef.current;
    const propietarioFormulario = usuarioFormularioIdRef.current;
    try {
      if (!uri) {
        return Alert.alert('Error', 'La ruta de imagen no es válida');
      }

      let sizeMB = 0;
      try {
        const info = await withTimeout(
          FileSystem.getInfoAsync(uri, { size: true }),
          PHOTO_FILE_TIMEOUT_MS,
          'La lectura local de la foto excedió el tiempo permitido.'
        );
        sizeMB = info?.size ? Number(info.size) / 1024 / 1024 : 0;
      } catch {
        // en algunos dispositivos no retorna size; continuamos
      }

      if (sizeMB > 6) {
        return Alert.alert('❌ Imagen demasiado grande', 'Intenta una foto más liviana (≤ 6 MB).');
      }

      // Persistimos la foto en documentDirectory para que no se pierda antes de sincronizar.
      marcarFotoEnProceso(uri);
      recordEvent('photo_process_start', { app_state: 'active', phase: 'photo', photo_size_bucket: photoSizeBucket(sizeMB * 1024 * 1024) }).catch(() => {});
      const destino = await prepararImagenPersistente(uri, fieldName);
      marcarFotoEnProceso(destino);
      if (!esSesionFormularioActual(sesionFormulario, propietarioFormulario)) {
        await FileSystem.deleteAsync(destino, { idempotent: true }).catch(() => {});
        return;
      }
      formDebug('foto capturada', { fieldName, capturedUri: uri, persistedUri: destino });
      const anterior = formulario[fieldName];
      if (/^file:\/\//i.test(anterior || '') && anterior !== destino) {
        await FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => {});
      }

      fotosPersistentesRef.current[fieldName] = destino;
      setter(destino);
      actualizarCampo(fieldName, destino);
      liberarFotoEnProceso(destino);
      recordEvent('photo_process_ok', { app_state: 'active', phase: 'photo' }).catch(() => {});

    } catch (error) {
      console.error('❌ Error al tomar o subir imagen:', error);
      const code = error?.photoCode || await registrarErrorFoto('persist', error);
      recordEvent('photo_process_error', { app_state: 'active', phase: 'photo', error_category: 'photo_process' }).catch(() => {});
      Alert.alert('Error al procesar foto', `No se pudo procesar la imagen. (${code})`);
    } finally {
      liberarFotoEnProceso(uri);
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  };

  const abrirCamara = (setter, fieldName, label) => {
    setCamaraEvidencia({ setter, fieldName, label });
  };

  const usarFotoCamara = (uri) => {
    const destino = camaraEvidencia;
    setCamaraEvidencia(null);
    if (!destino) return;
    procesarFotoCapturada(uri, destino.setter, destino.fieldName);
  };

  const seleccionarImagen = async (setter, fieldName) => {
    if (galeriaOperacionRef.current) {
      Alert.alert('Galería ocupada', 'Espera a que termine la selección anterior o cierra el selector abierto.');
      return;
    }
    const sesionFormulario = formularioSesionRef.current;
    const propietarioFormulario = usuarioFormularioIdRef.current;
    let selectorFinalizado = false;
    let operacionGaleria = null;
    try {
      // Photo Picker del sistema (Android 13+ sin permiso; Android 12 con
      // fallback del picker): no se solicita permiso previo para no bloquear.
      const promesaNativa = ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
        allowsEditing: false,
      });
      operacionGaleria = { invalidada: false };
      galeriaOperacionRef.current = operacionGaleria;
      promesaNativa.catch(() => {}).finally(() => {
        if (galeriaOperacionRef.current === operacionGaleria) galeriaOperacionRef.current = null;
      });
      const result = await withTimeout(
        promesaNativa,
        GALLERY_TIMEOUT_MS,
        'La galería excedió el tiempo permitido.'
      );
      selectorFinalizado = true;
      if (operacionGaleria.invalidada) return;
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return Alert.alert('Error', 'La ruta de imagen no es válida.');
      const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(asset.uri)?.[1]?.toLowerCase();
      if (extension && !['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(extension)) {
        return Alert.alert('Error', 'Selecciona una foto válida (JPG o PNG).');
      }
      const infoArchivo = await withTimeout(
        FileSystem.getInfoAsync(asset.uri, { size: true }),
        PHOTO_FILE_TIMEOUT_MS,
        'La lectura local de la foto excedió el tiempo permitido.'
      ).catch(() => null);
      if (infoArchivo && infoArchivo.exists === false) {
        return Alert.alert('Error', 'No se pudo leer la imagen seleccionada.');
      }
      const size = typeof asset.fileSize === 'number' ? asset.fileSize : infoArchivo?.size;
      if (typeof size === 'number' && size <= 0) {
        return Alert.alert('Error', 'La imagen seleccionada está vacía.');
      }
      if (typeof size === 'number' && size / 1024 / 1024 > 6) {
        return Alert.alert('❌ Imagen demasiado grande', 'Selecciona una imagen más liviana (≤ 6 MB).');
      }
      const destino = await prepararImagenPersistente(asset.uri, fieldName);
      if (!esSesionFormularioActual(sesionFormulario, propietarioFormulario)) {
        await FileSystem.deleteAsync(destino, { idempotent: true }).catch(() => {});
        return;
      }
      formDebug('foto seleccionada', { fieldName, capturedUri: asset.uri, persistedUri: destino });
      const anterior = formulario[fieldName];
      if (/^file:\/\//i.test(anterior || '') && anterior !== destino) {
        await FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => {});
      }
      fotosPersistentesRef.current[fieldName] = destino;
      setter(destino);
      actualizarCampo(fieldName, destino);
    } catch (error) {
      console.error('❌ Error al seleccionar imagen:', error);
      if (!selectorFinalizado && operacionGaleria) operacionGaleria.invalidada = true;
      const code = error?.photoCode || await registrarErrorFoto(selectorFinalizado ? 'persist' : 'gallery', error);
      const operacionSigueActiva = galeriaOperacionRef.current === operacionGaleria;
      Alert.alert(
        'Error de galería',
        operacionSigueActiva
          ? `No se pudo procesar la imagen. (${code})\nCierra el selector y vuelve a intentarlo.`
          : `No se pudo procesar la imagen. (${code})`,
        operacionSigueActiva
          ? [{ text: 'Cerrar', style: 'cancel' }]
          : [
            { text: 'Cerrar', style: 'cancel' },
            { text: 'Reintentar', onPress: () => seleccionarImagen(setter, fieldName) },
          ]
      );
    }
  };

  const eliminarFoto = async (setter, fieldName) => {
    const uri = formulario[fieldName];
    if (/^file:\/\//i.test(uri || '')) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    delete fotosPersistentesRef.current[fieldName];
    setter(null);
    actualizarCampo(fieldName, '');
  };

  const abrirEvidencia = (uri, setter, fieldName, label) => {
    if (!uri) {
      if (fieldName === 'foto_cash_in') {
        Alert.alert('Evidencia Cash-In', 'Selecciona el origen de la imagen.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Galería', onPress: () => seleccionarImagen(setter, fieldName) },
          { text: 'Cámara', onPress: () => abrirCamara(setter, fieldName, label) },
        ]);
      } else {
        abrirCamara(setter, fieldName, label);
      }
      return;
    }
    setEvidenciaPreview({ uri, setter, fieldName, label });
  };

  const cambiarEvidencia = () => {
    const actual = evidenciaPreview;
    if (!actual) return;
    setEvidenciaPreview(null);
    if (actual.fieldName === 'foto_cash_in') {
      Alert.alert('Evidencia Cash-In', 'Selecciona el origen de la imagen.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Galería', onPress: () => seleccionarImagen(actual.setter, actual.fieldName) },
        { text: 'Cámara', onPress: () => abrirCamara(actual.setter, actual.fieldName, actual.label) },
      ]);
      return;
    }
    abrirCamara(actual.setter, actual.fieldName, actual.label);
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
    const esTranseunte = esActivacionTranseunte(data.tipo_activacion);
    if (!esTranseunte && !data.ciudad_activacion) {
      return isConnected === false
        ? 'Selecciona la ciudad de activación.'
        : 'No se pudo detectar la ciudad por GPS. Pulsa "Actualizar ubicación".';
    }
    if (!esTranseunte && !data.zona_activacion) return 'Selecciona la zona de activación.';
    if (!impulsadorActual) return 'No se pudo obtener el nombre del activador.';

    if (!esTranseunte) {
      if (!textoSeguro(data.nombres_cliente).trim()) return 'Ingresa los nombres del cliente.';
      if (!textoSeguro(data.apellidos_cliente).trim()) return 'Ingresa los apellidos del cliente.';
      if (!/^\d{7,9}$/.test(carnetNormalizado)) return 'La cédula debe tener 7 a 9 números.';
      if (!/^\d{8}$/.test(telefonoNormalizado)) return 'El teléfono debe tener exactamente 8 números.';
      if (telefonoNormalizado && telefonoNormalizado === carnetNormalizado) {
        return 'El número de teléfono no puede ser igual al carnet';
      }
      if (textoSeguro(data.email_cliente) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(textoSeguro(data.email_cliente))) return 'El correo no parece válido.';
    }

    if (requiereTiendaBarrio && !data.tamano_tienda) {
      return 'Selecciona el tamaño de la tienda.';
    }
    // Nota: `tipo_tienda` se mantiene en el estado para compatibilidad,
    // pero la UI ya usa `tamano_tienda` como campo único de tamaño.
    if (requiereComercioGeneral && !data.rubro_comercio) return 'Selecciona el rubro del comercio.';
    if (requiereComercioGeneral && data.rubro_comercio === 'Otro' && !textoSeguro(data.rubro_comercio_otro).trim()) return 'Especifica el otro rubro del comercio.';
    if (requiereComercioGeneral && data.comercio_fuera_mercado === null) return 'Indica si el comercio está fuera del mercado.';
    if (data.hubo_error && !data.tipo_error) return 'Selecciona el tipo de error.';
    if (data.hubo_error && data.tipo_error === 'Otro' && !textoSeguro(data.descripcion_error).trim()) return 'Describe el error.';
    if (data.es_plaza_temporal && !plazasTemporales.some((item) => item?.nombre === data.plaza_temporal)) return 'La plaza temporal seleccionada no está autorizada.';

    if (!data.fecha_activacion) {
      return 'No se pudo obtener la fecha de activación.';
    }

    const reglaFotosValidar = resolverReglaFotografias(data.tipo_grupo, data.tipo_activacion);
    if (reglaFotosValidar.requiereEvidencia && !data.foto_url && !fotoPrincipal) return 'Debes cargar la foto de comprobación.';
    if (reglaFotosValidar.requiereCashIn && !data.foto_cash_in && !fotoCashIn) return 'Debes cargar la foto del Cash-In.';

    return null;
  };

  const fotoPrincipalUri = fotoPrincipal || formulario.foto_url;
  const fotoCashInUri = fotoCashIn || formulario.foto_cash_in;
  const fotosCapturadas = Number(Boolean(fotoPrincipalUri)) + Number(Boolean(fotoCashInUri));
  const fotosObligatoriasCapturadas = Number(requiereFotoPrincipal && Boolean(fotoPrincipalUri))
    + Number(requiereCashIn && Boolean(fotoCashInUri));
  const resumenFotos = sinFotosObligatorias
    ? `${fotosCapturadas} adjunta${fotosCapturadas === 1 ? '' : 's'} · Opcionales`
    : `${fotosObligatoriasCapturadas}/${totalFotosRequeridas}`;
  const gpsListo = tieneCoordenadasValidas(formulario);
  const gpsResumen = detectandoCiudad
    ? 'Detectando'
    : gpsListo
      ? 'Listo'
      : 'Pendiente';
  const faltanteActual = validar(formulario);
  const formularioCompleto = !faltanteActual;

  const guardarFormulario = async () => {
    if (guardandoRef.current) return;
    const sesionGuardado = formularioSesionRef.current;
    const propietarioGuardado = usuarioFormularioIdRef.current;
    guardandoRef.current = true;
    setGuardando(true);
    setEstadoGuardado('Guardando…');
    // Asegura fecha e id si no están seteados (fallback a hoy)
    const fecha = formulario.fecha_activacion || new Date().toISOString().split('T')[0];
    const formId = formulario.id || uuidv4();
    let formularioConBasicos = {
      ...formulario,
      fecha_activacion: fecha,
      id: formId,
      impulsador: normalizarNombreVisible(formulario.impulsador || usuario?.nombre || ''),
    };
    if (!formulario.fecha_activacion || !formulario.id) {
      setFormulario(prev => ({ ...prev, fecha_activacion: fecha, id: formId }));
    }

    let errorMsg = validar(formularioConBasicos);
    if (isConnected !== false && errorMsg === 'No se pudo detectar la ciudad por GPS. Pulsa "Actualizar ubicación".') {
      const solicitudActiva = gpsSolicitudRef.current;
      const resultadoActivo = solicitudActiva ? await solicitudActiva : null;
      const ubicacionFinal = tieneCoordenadasValidas(resultadoActivo || {})
        ? resultadoActivo
        : await detectarCiudadPorGps({ silent: true });
      if (!esSesionFormularioActual(sesionGuardado, propietarioGuardado)) return;
      if (ubicacionFinal) {
        formularioConBasicos = { ...formularioConBasicos, ...ubicacionFinal };
        errorMsg = validar(formularioConBasicos);
        // GPS válido = coordenadas válidas: si reverseGeocode no resolvió ciudad
        // pero hay coordenadas, no se bloquea el guardado por la ciudad.
        if (
          errorMsg === 'No se pudo detectar la ciudad por GPS. Pulsa "Actualizar ubicación".'
          && tieneCoordenadasValidas(formularioConBasicos)
        ) {
          errorMsg = '';
        }
      }
    }
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
      const requiereElegibilidad = requiereValidacionReactivacion(formularioConBasicos.tipo_activacion);
      if (isConnected && requiereElegibilidad) {
        const elegibilidad = await validarElegibilidadReactivacion({
          ci: formularioConBasicos.ci_cliente,
          telefono: formularioConBasicos.telefono_cliente,
          tipoActivacion: formularioConBasicos.tipo_activacion,
          registroId: formId,
          fechaReferencia: fecha,
        });
        if (!esSesionFormularioActual(sesionGuardado, propietarioGuardado)) return;
        if (!elegibilidad.ok) {
          setEstadoGuardado(`Error: ${elegibilidad.mensaje}`);
          Alert.alert('Periodo mínimo no cumplido', enmascararMarcaVisible(elegibilidad.mensaje, usuario));
          return;
        }
      }

      let latitud = formularioConBasicos.latitud;
      let longitud = formularioConBasicos.longitud;
      try {
        if (!tieneCoordenadasValidas({ latitud, longitud })) {
          const solicitudActiva = gpsSolicitudRef.current;
          const resultadoActivo = solicitudActiva ? await solicitudActiva : null;
          const coordenadas = tieneCoordenadasValidas(resultadoActivo || {})
            ? resultadoActivo
            : await detectarCiudadPorGps({ silent: true });
          if (!esSesionFormularioActual(sesionGuardado, propietarioGuardado)) return;
          if (!tieneCoordenadasValidas(coordenadas || {})) {
            throw new Error('La ubicación no devolvió coordenadas válidas.');
          }
          latitud = coordenadas.latitud;
          longitud = coordenadas.longitud;
        }
      } catch (gpsError) {
        formDebug('gps no disponible al guardar', gpsError?.message || gpsError);
        setEstadoGuardado('Error: ubicación requerida');
        Alert.alert('Ubicación requerida', MENSAJE_GPS_OBLIGATORIO);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(MENSAJE_GPS_OBLIGATORIO);
        }
        return;
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
      const esBaseTienda = baseActivacion === 'tienda_barrio';
      const esBaseComercio = baseActivacion === 'comercio';
      const fotoPrincipalPersistente = fotosPersistentesRef.current.foto_url || fotoPrincipal || formulario.foto_url;
      const fotoCashInPersistente = fotosPersistentesRef.current.foto_cash_in || fotoCashIn || formulario.foto_cash_in;
      // Valida la foto principal siempre que esté presente (incluye evidencia
      // voluntaria de transeúnte); su ausencia sigue permitida solo para transeúnte.
      const fotoLocalError = await validarFotoLocalDisponible(fotoPrincipalPersistente, 'activación')
        || (fotoCashInPersistente ? await validarFotoLocalDisponible(fotoCashInPersistente, 'Cash-In') : null);
      if (!esSesionFormularioActual(sesionGuardado, propietarioGuardado)) return;
      if (fotoLocalError) {
        setEstadoGuardado(`Error: ${fotoLocalError}`);
        Alert.alert('Foto no disponible', fotoLocalError);
        return;
      }

      const datosFormulario = {
        ...formularioConBasicos,
        base_activacion: baseActivacion,
        fecha_activacion: fecha,
        latitud,
        longitud,
        distrito_gps: formularioConBasicos.distrito_gps || null,
        region_gps: formularioConBasicos.region_gps || null,
        es_reactivacion: esReactivacion,
        usuario_id: propietarioGuardado,
        impulsador: formularioConBasicos.impulsador,
        plaza: formularioConBasicos.es_plaza_temporal
          ? formularioConBasicos.plaza_temporal
          : plazaBaseValor,
        // Transeúnte: ausencia permitida, pero la evidencia voluntaria se conserva.
        foto_url: fotoPrincipalPersistente || null,
        foto_cash_in: fotoCashInPersistente || null,
        tipo_tienda: null,
        tamano_tienda: esBaseTienda ? optionalTextOrNull(formularioConBasicos.tamano_tienda) : null,
        tipo_comercio: esBaseComercio ? optionalTextOrNull(formularioConBasicos.tipo_comercio) : null,
        rubro_comercio: esBaseComercio ? optionalTextOrNull(formularioConBasicos.rubro_comercio) : null,
        rubro_comercio_otro: esBaseComercio ? optionalTextOrNull(formularioConBasicos.rubro_comercio_otro) : null,
        comercio_fuera_mercado: esBaseComercio ? formularioConBasicos.comercio_fuera_mercado : null,
        estado_sync: 'offline_pending',
        dispositivo: DEVICE_INFO,
        _sync: {
          status: 'pending',
          tries: 0,
          error: null,
          requiresEligibilityCheck: !isConnected && requiereElegibilidad,
          localPhotos: {
            // Incluye foto_url siempre que sea URI local (cubre evidencia
            // voluntaria de transeúnte); su ausencia sigue permitida.
            ...(typeof fotoPrincipalPersistente === 'string' && /^file:\/\//i.test(fotoPrincipalPersistente)
              ? { foto_url: fotoPrincipalPersistente }
              : {}),
            ...(typeof fotoCashInPersistente === 'string' && /^file:\/\//i.test(fotoCashInPersistente)
              ? { foto_cash_in: fotoCashInPersistente }
              : {}),
          },
        },
      };
      formDebug('formulario local preparado', {
        savedLocalUri: {
          foto_url: datosFormulario._sync.localPhotos.foto_url || datosFormulario.foto_url,
          foto_cash_in: datosFormulario._sync.localPhotos.foto_cash_in || datosFormulario.foto_cash_in,
        },
      });

      const idLocalGuardado = await guardarFormularioLocal(datosFormulario);
      if (!esSesionFormularioActual(sesionGuardado, propietarioGuardado)) return;
      const formularioNuevaActivacion = {
        ...formularioInicial,
        id: '',
        impulsador: normalizarNombreVisible(usuario?.nombre || ''),
        ciudad_activacion: isConnected === false
          ? resolverCiudadKey(usuario?.plaza)
          : formularioConBasicos.ciudad_activacion,
      };
      // Guardado correcto: el borrador ya no se necesita.
      // eliminarBorrador solo se ejecuta si guardarFormularioLocal no lanzó.
      formularioSesionRef.current += 1;
      gpsSolicitudRef.current = null;
      setEdicionActiva(false);
      await eliminarBorrador(datosFormulario.usuario_id);
      const mensajePendiente = 'Activación guardada. Sincronización pendiente.';
      setEstadoGuardado(mensajePendiente);
      setMensajeGuardado(mensajePendiente);
      contarFormulariosLocales?.();
      ciudadManualRef.current = false;
      setFormulario(formularioNuevaActivacion);
      fotosPersistentesRef.current = {};
      setFotoPrincipal(null);
      setFotoCashIn(null);
      setActivacionGuardada(true);
      setBorradorResetToken((actual) => actual + 1);
      setGuardando(false);
      guardandoRef.current = false;
      if (isConnected && typeof onSincronizar === 'function') {
        onSincronizar({ showAlerts: false, force: true, targetLocalId: idLocalGuardado })
          .then((syncResult) => {
            const sincronizada = Array.isArray(syncResult?.syncedLocalIds)
              ? syncResult.syncedLocalIds.includes(idLocalGuardado)
              : syncResult?.status === 'synced' && syncResult?.synced > 0;
            if (sincronizada) {
              setEstadoGuardado('Activación sincronizada');
              setMensajeGuardado('Activación sincronizada');
            }
          })
          .catch((syncError) => {
            formDebug('[sync] error al sincronizar formulario guardado:', syncError?.message || syncError);
          });
      }
    } catch (err) {
      if (!esSesionFormularioActual(sesionGuardado, propietarioGuardado)) return;
      console.error('Error al guardar formulario:', err);
      Alert.alert('Error', enmascararMarcaVisible(err?.message ? err.message : 'No se pudo guardar el formulario.', usuario));
      setEstadoGuardado(`Error: ${err?.message || 'No se pudo guardar'}`);
    } finally {
      if (esSesionFormularioActual(sesionGuardado, propietarioGuardado)) {
        guardandoRef.current = false;
        setGuardando(false);
      }
    }
  };

  const usuarioActualId = usuario?.id || null;
  if (usuarioFormularioId !== usuarioActualId) {
    return (
      <View style={[styles.container, width <= 430 && styles.containerMobile]}>
        <View style={styles.saveDoneCard}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.saveDoneText}>Preparando formulario...</Text>
        </View>
      </View>
    );
  }

  if (!usuario || !usuario.id) {
    return <Text style={{ padding: 20, color: colors.text }}>Cargando usuario...</Text>;
  }

  if (activacionGuardada) {
    return (
      <View style={[styles.container, width <= 430 && styles.containerMobile]}>
        <View style={styles.saveDoneCard}>
          <Text style={styles.saveDoneTitle}>{enmascararMarcaVisible(mensajeGuardado || 'Activación guardada', usuario)}</Text>
          <Text style={styles.saveDoneText}>
            Este registro ya no puede ser modificado.
          </Text>
          <View style={styles.saveDoneActions}>
            <TouchableOpacity
              onPress={() => {
                setActivacionGuardada(false);
                setEstadoGuardado('');
                setMensajeGuardado('');
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
            <Text style={styles.badgeText}>
              {sinFotosObligatorias
                ? 'Evidencias opcionales'
                : `${totalFotosRequeridas} foto${totalFotosRequeridas === 1 ? '' : 's'} obligatoria${totalFotosRequeridas === 1 ? '' : 's'}`}
            </Text>
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
                onValueChange={(v) => { ciudadManualRef.current = true; setFormulario((prev) => ({ ...prev, ciudad_activacion: v, zona_activacion: '' })); }}
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
          <Text style={styles.statusSummaryValue}>{resumenFotos}</Text>
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
            {requiereComercioGeneral && (
              <Image
                source={require('../assets/comercio.png')}
                style={[styles.guiaImagen, { height: guiaRubrosImageHeight }]}
                resizeMode="contain"
              />
            )}

          </>
        ) : null}

        {/* `tipo_tienda` estaba duplicando el campo de tamaño; se oculta en la UI
            y se utiliza únicamente `tamano_tienda` para mantener un único valor. */}
        {/* `tipo_comercio` se conserva solo para compatibilidad histórica. */}

        {requiereComercioGeneral && (
          <>
            <Text style={styles.label}>Rubro *</Text>
            <Picker
              selectedValue={formulario.rubro_comercio}
              onValueChange={(v) => setFormulario((prev) => ({
                ...prev,
                rubro_comercio: v,
                rubro_comercio_otro: v === 'Otro' ? prev.rubro_comercio_otro : '',
              }))}
              style={styles.picker}
            >
              <Picker.Item label="Seleccionar..." value="" />
              {RUBROS_COMERCIO.map((item) => <Picker.Item key={item} label={item} value={item} />)}
            </Picker>
            {formulario.rubro_comercio === 'Otro' && (
              <>
                <Text style={styles.label}>Otro rubro *</Text>
                <TextInput
                  style={styles.input}
                  value={formulario.rubro_comercio_otro}
                  onChangeText={(v) => actualizarCampo('rubro_comercio_otro', v)}
                />
              </>
            )}
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
        <>
          <Text style={styles.label}>Ubicación de Interés (Eventos)</Text>
          {plazasTemporalesVisibles.length === 0 ? (
              <View style={styles.fixedPlaza}>
                <Text style={styles.plazaTag}>Base</Text>
                <Text style={styles.fixedPlazaText}>{plazaBaseLabel}</Text>
              </View>
            ) : (
              <Picker selectedValue={plazaSeleccionada} onValueChange={onPlazaChange} style={styles.picker}>
                <Picker.Item label={`Base · ${plazaBaseLabel}`} value="base" />
                {plazasTemporalesVisibles.map((plaza) => (
                  <Picker.Item
                    key={plaza.id}
                    label={`Temporal · ${enmascararMarcaVisible(plaza.nombre_legible || etiquetaPlaza(plaza.nombre, plaza.nombre), usuario)}`}
                    value={`temporal:${plaza.id}`}
                    color={colors.warning}
                  />
                ))}
              </Picker>
            )}
          </>

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
          <Text style={styles.evidenceSectionTitle}>
            {sinFotosObligatorias
              ? `📸 Evidencias opcionales (${fotosCapturadas} adjunta${fotosCapturadas === 1 ? '' : 's'})`
              : `📸 Evidencias (${fotosObligatoriasCapturadas}/${totalFotosRequeridas})`}
          </Text>
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
            {!!evidenciaPreview?.uri && <Image source={{ uri: evidenciaPreview.uri }} style={styles.previewImage} resizeMode="contain" resizeMethod="resize" />}
            <View style={styles.previewActions}>
              <TouchableOpacity style={styles.previewActionPrimary} onPress={cambiarEvidencia}><Text style={styles.previewActionPrimaryText}>Cambiar foto</Text></TouchableOpacity>
              <TouchableOpacity style={styles.previewActionDanger} onPress={eliminarEvidencia}><Text style={styles.previewActionDangerText}>Eliminar foto</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.previewClose} onPress={() => setEvidenciaPreview(null)}><Text style={styles.previewCloseText}>Cerrar</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <CameraEvidencia
        visible={!!camaraEvidencia}
        label={camaraEvidencia?.label}
        onCancel={() => setCamaraEvidencia(null)}
        onUse={usarFotoCamara}
      />

      {!!estadoGuardado && (
        <View style={styles.saveStatus}>
          {guardando && <ActivityIndicator size="small" color={colors.primary} />}
          <Text style={styles.saveStatusText}>{enmascararMarcaVisible(estadoGuardado, usuario)}</Text>
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
        <TouchableOpacity
          onPress={confirmarBorrarFormulario}
          disabled={guardando}
          style={[styles.botonMini, styles.botonBorrar]}
          activeOpacity={0.85}
        >
          <Text style={styles.botonBorrarTexto}>Borrar formulario</Text>
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
    aspectRatio: 1.5,
    alignSelf: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
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
  botonBorrar: {
    marginLeft: spacing.sm,
    borderWidth: 1,
    borderColor: '#B4232A',
    backgroundColor: 'transparent',
  },
  botonBorrarTexto: {
    color: '#B4232A',
    fontSize: fontSizes.medium,
    fontWeight: '700',
    textAlign: 'center',
  },
  botonTextoMini: {
    color: '#FFFFFF',
    fontSize: fontSizes.medium,
    fontWeight: '700',
    textAlign: 'center',
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
