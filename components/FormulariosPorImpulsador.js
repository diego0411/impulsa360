import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, StyleSheet, RefreshControl, Alert,
  AppState, Modal, TouchableOpacity, Image, ScrollView, useWindowDimensions,
  Platform
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { prepararImagenPersistente, resolverUrlDeFoto } from '../lib/upload';
import { evaluarDimensionesCaptura } from '../lib/cameraPhotoSafety';
import {
  LADO_REDUCCION_GALERIA,
  puedeReducirImagenGaleria,
  reducirImagenGaleria,
} from '../lib/galleryImageDownsampler';
import { actualizarFormularioLocal, leerFormulariosLocalesSeguro, obtenerFormularioPorId } from '../lib/storage';
import { etiquetaPlaza } from '../lib/plazas';
import { fechaBolivia } from '../lib/fechaBolivia';
import {
  PERIODO_MES_ACTUAL,
  crearOpcionesPeriodoMensual,
  resolverPeriodoMensual,
} from '../lib/periodoMensual';
import { withTimeout } from '../lib/asyncTimeout';
import { enmascararMarcaVisible } from '../lib/brandMask';
import { enmascararDatoCliente } from '../lib/customerMask';
import { colors, spacing, fontSizes, radius } from '../styles/theme';
import CameraEvidencia from './CameraEvidencia';
import SelectorRN from './SelectorRN';
import { registrarErrorFoto } from '../lib/photoDiagnostics';
import {
  claveFormulario,
  combinarHistorialLocalRemoto,
  combinarFormulariosSinDuplicados,
  crearControlConsultaUnica,
  persistirReemplazoFoto,
  puedeConsultarHistorialRemoto,
} from '../lib/historialActivaciones';
import { resolverLecturaPendientes } from '../lib/offlineSafety';

const PAGE_SIZE = 20;
const QUERY_TIMEOUT_MS = 10000;
const GALLERY_TIMEOUT_MS = 30000;
const PHOTO_FILE_TIMEOUT_MS = 12000;
const esFotoLocal = (value) => /^(file|content):\/\//i.test(String(value || ''));
const normalizarRol = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_|_$/g, '');
const esRolAdministrador = (value) => {
  const rol = normalizarRol(value);
  return ['admin', 'administrador', 'administrator'].some(
    (item) => rol === item || rol.startsWith(`${item}_`),
  );
};
const rolesDeUsuario = (usuario) => (
  [usuario?.rol, usuario?.role, ...(Array.isArray(usuario?.roles) ? usuario.roles : [])]
    .map((rol) => (typeof rol === 'string' ? rol : rol?.rol || rol?.role))
    .filter(Boolean)
);
const resolverFotoDetalle = async (value) => {
  if (!value) return { uri: '', perdida: false };
  if (!esFotoLocal(value)) {
    return { uri: await resolverUrlDeFoto(value), perdida: false };
  }

  const info = await FileSystem.getInfoAsync(value, { size: true }).catch(() => null);
  return { uri: info?.exists ? value : '', perdida: !info?.exists };
};

export default function FormulariosPorImpulsador({
  usuario,
  isConnected,
  isInternetReachable,
  onSincronizar,
}) {
  const usuarioId = usuario?.id;
  const [formulariosRemotos, setFormulariosRemotos] = useState([]);
  const [formulariosLocales, setFormulariosLocales] = useState([]);
  const [historialOwnerId, setHistorialOwnerId] = useState(usuarioId || null);
  const [cargando, setCargando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastError, setLastError] = useState(null);
  const [lecturaLocalError, setLecturaLocalError] = useState(null);
  const [cargaRemotaCompletada, setCargaRemotaCompletada] = useState(false);
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState(PERIODO_MES_ACTUAL);

  // Detalle
  const [detalleVisible, setDetalleVisible] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalleFotoUrl, setDetalleFotoUrl] = useState('');
  const [detalleFotoCashInUrl, setDetalleFotoCashInUrl] = useState('');
  const [fotoDetalleActiva, setFotoDetalleActiva] = useState('activacion');
  const [fotosPerdidas, setFotosPerdidas] = useState({});
  const [camaraReparacion, setCamaraReparacion] = useState(null);

  const pageRef = useRef(0);
  const channelRef = useRef(null);
  const galeriaOperacionRef = useRef(null);
  const requestIdRef = useRef(0);
  const localRequestIdRef = useRef(0);
  const consultaControlRef = useRef(null);
  if (!consultaControlRef.current) consultaControlRef.current = crearControlConsultaUnica();
  const refreshPendienteRef = useRef(null);
  const refrescarHistorialActualRef = useRef(null);
  const remotoBloqueadoRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const remotoDisponible = puedeConsultarHistorialRemoto({ isConnected, isInternetReachable });
  const remotoDisponibleRef = useRef(remotoDisponible);
  const conexionDisponibleRef = useRef(remotoDisponible);
  const mountedRef = useRef(true);
  const ownerActualRef = useRef(usuarioId || null);
  const usuarioActualRef = useRef(usuario);
  const localesActualesRef = useRef({ ownerId: usuarioId || null, rows: [] });
  const localesAusentesConfirmacionesRef = useRef(new Map());
  ownerActualRef.current = usuarioId || null;
  usuarioActualRef.current = usuario;
  remotoDisponibleRef.current = remotoDisponible;
  const hoyBolivia = fechaBolivia();
  const periodoConsulta = useMemo(
    () => resolverPeriodoMensual(periodoSeleccionado, hoyBolivia),
    [hoyBolivia, periodoSeleccionado],
  );
  const opcionesPeriodo = useMemo(
    () => crearOpcionesPeriodoMensual(hoyBolivia),
    [hoyBolivia],
  );

  const administrador = rolesDeUsuario(usuario).some(esRolAdministrador);
  const { height } = useWindowDimensions();
  const modalMaxHeight = Math.min(height * 0.85, 640);
  const fotoHeight = Math.min(height * 0.35, 260);

  const cargarLocales = useCallback(async () => {
    if (!usuarioId) return;
    const ownerId = usuarioId;
    const requestId = ++localRequestIdRef.current;
    try {
      const lectura = resolverLecturaPendientes(
        await leerFormulariosLocalesSeguro(),
        ownerId,
      );
      if (
        !mountedRef.current
        || ownerActualRef.current !== ownerId
        || requestId !== localRequestIdRef.current
      ) return;
      if (!lectura.ok) {
        setLecturaLocalError('No se pudieron verificar las activaciones pendientes locales.');
        return;
      }
      setLecturaLocalError(null);
      const filtrados = lectura.rows;
      localesActualesRef.current = { ownerId, rows: filtrados };
      setFormulariosLocales((prev) => combinarFormulariosSinDuplicados(filtrados, prev));
    } catch (err) {
      console.warn('⚠️ No se pudieron cargar formularios locales:', err?.message || err);
      // Un fallo transitorio no reemplaza pendientes válidos ya visibles.
      if (
        mountedRef.current
        && ownerActualRef.current === ownerId
        && requestId === localRequestIdRef.current
      ) {
        setLecturaLocalError('No se pudieron verificar las activaciones pendientes locales.');
      }
    }
  }, [usuarioId]);

  const formularios = useMemo(() => {
    return combinarHistorialLocalRemoto({
      locales: formulariosLocales,
      remotos: formulariosRemotos,
      ownerId: usuarioId,
      periodo: periodoConsulta,
      administrador,
    });
  }, [administrador, formulariosLocales, formulariosRemotos, periodoConsulta, usuarioId]);

  const fetchPage = useCallback(async ({ reset = false, silent = false } = {}) => {
    if (!usuarioId || ownerActualRef.current !== usuarioId) return;
    const ownerId = usuarioId;
    const requestId = ++requestIdRef.current;

    try {
      setLastError(null);
      if (reset) {
        setCargando(true);
        pageRef.current = 0;
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }

      const from = pageRef.current * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
          .from('activaciones')
          .select('*')
          .eq('usuario_id', ownerId)
          .order('fecha_activacion', { ascending: false })
          .gte('fecha_activacion', periodoConsulta.desde)
          .lt('fecha_activacion', periodoConsulta.hastaExclusivo)
          .range(from, Math.max(from, to));

      const { data, error } = await withTimeout(
        query,
        QUERY_TIMEOUT_MS,
        'La señal está muy débil para cargar activaciones.'
      );

      if (error) {
        console.error('❌ Supabase select error:', error);
        if (!mountedRef.current || ownerActualRef.current !== ownerId || requestId !== requestIdRef.current) return;
        setLastError(error.message || String(error));
        remotoBloqueadoRef.current = true;
        setHasMore(false);
        if (reset && !silent) Alert.alert('Error', enmascararMarcaVisible(`No se pudieron actualizar los formularios.\n${error.message || ''}`, usuarioActualRef.current));
        return;
      }

      // Un nombre visible no acredita propiedad de registros legacy sin usuario_id.
      const rows = data || [];

      if (!mountedRef.current || ownerActualRef.current !== ownerId || requestId !== requestIdRef.current) return;
      setFormulariosRemotos((prev) => (reset ? combinarFormulariosSinDuplicados([], rows) : combinarFormulariosSinDuplicados(prev, rows)));
      if (reset && localesActualesRef.current.ownerId === ownerId) {
        const localesActuales = localesActualesRef.current.rows;
        const idsActuales = new Set(localesActuales.map(claveFormulario).filter(Boolean));
        const idsRemotos = new Set(rows.map(claveFormulario).filter(Boolean));
        setFormulariosLocales((prev) => {
          const retenidos = prev.filter((item) => {
            const id = claveFormulario(item);
            if (!id || idsActuales.has(id) || idsRemotos.has(id)) {
              if (id) localesAusentesConfirmacionesRef.current.delete(id);
              return false;
            }
            const confirmaciones = localesAusentesConfirmacionesRef.current.get(id) || 0;
            localesAusentesConfirmacionesRef.current.set(id, confirmaciones + 1);
            return confirmaciones === 0;
          });
          return combinarFormulariosSinDuplicados(localesActuales, retenidos);
        });
      }
      setCargaRemotaCompletada(true);
      remotoBloqueadoRef.current = false;

      const noMore = !rows || rows.length < PAGE_SIZE;
      setHasMore(!noMore);
      if (!noMore) pageRef.current += 1;
    } catch (err) {
      console.error('❌ FetchPage error:', err);
      if (!mountedRef.current || ownerActualRef.current !== ownerId || requestId !== requestIdRef.current) return;
      setLastError(err?.message || String(err));
      remotoBloqueadoRef.current = true;
      setHasMore(false);
      if (reset && !silent) Alert.alert('Error', enmascararMarcaVisible(`No se pudieron actualizar los formularios.\n${err?.message || ''}`, usuarioActualRef.current));
    } finally {
      if (!mountedRef.current || ownerActualRef.current !== ownerId || requestId !== requestIdRef.current) return;
      setCargando(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [periodoConsulta.desde, periodoConsulta.hastaExclusivo, usuarioId]);

  const ejecutarConsulta = useCallback((operacion, pendienteSiOcupada = null) => {
    const resultado = consultaControlRef.current.ejecutar(operacion);
    if (!resultado.iniciada) {
      if (pendienteSiOcupada) {
        const anterior = refreshPendienteRef.current;
        refreshPendienteRef.current = {
          silent: anterior ? anterior.silent && pendienteSiOcupada.silent : pendienteSiOcupada.silent,
          desbloquearRemoto: Boolean(anterior?.desbloquearRemoto || pendienteSiOcupada.desbloquearRemoto),
        };
      }
      return resultado.promesa;
    }
    return resultado.promesa.finally(() => {
      const pendiente = refreshPendienteRef.current;
      refreshPendienteRef.current = null;
      if (pendiente && mountedRef.current) {
        globalThis.setTimeout(() => refrescarHistorialActualRef.current?.(pendiente), 0);
      }
    });
  }, []);

  const refrescarHistorial = useCallback(({ silent = true, desbloquearRemoto = false } = {}) => {
    const ownerId = usuarioId;
    if (!ownerId || ownerActualRef.current !== ownerId) return Promise.resolve();
    return ejecutarConsulta(async () => {
      await cargarLocales();
      if (!mountedRef.current || ownerActualRef.current !== ownerId) return;
      if (!remotoDisponibleRef.current) {
        setHasMore(false);
        setCargando(false);
        setRefreshing(false);
        setLoadingMore(false);
        return;
      }
      if (remotoBloqueadoRef.current && !desbloquearRemoto) {
        setHasMore(false);
        setCargando(false);
        setRefreshing(false);
        setLoadingMore(false);
        return;
      }
      if (desbloquearRemoto) remotoBloqueadoRef.current = false;
      await fetchPage({ reset: true, silent });
    }, { silent, desbloquearRemoto });
  }, [cargarLocales, ejecutarConsulta, fetchPage, usuarioId]);
  refrescarHistorialActualRef.current = refrescarHistorial;

  const seleccionarPeriodo = useCallback((periodo) => {
    if (periodo === periodoSeleccionado) return;
    requestIdRef.current += 1;
    remotoBloqueadoRef.current = false;
    pageRef.current = 0;
    setPeriodoSeleccionado(periodo);
    setFormulariosRemotos([]);
    setLastError(null);
    setLecturaLocalError(null);
    setCargaRemotaCompletada(false);
    setHasMore(remotoDisponibleRef.current);
    setLoadingMore(false);
    setRefreshing(false);
    setCargando(Boolean(usuarioId));
  }, [periodoSeleccionado, usuarioId]);

  useEffect(() => {
    requestIdRef.current += 1;
    localRequestIdRef.current += 1;
    remotoBloqueadoRef.current = false;
    if (galeriaOperacionRef.current) galeriaOperacionRef.current.invalidada = true;
    galeriaOperacionRef.current = null;
    localesActualesRef.current = { ownerId: usuarioId || null, rows: [] };
    localesAusentesConfirmacionesRef.current.clear();
    pageRef.current = 0;
    setFormulariosRemotos([]);
    setFormulariosLocales([]);
    setLastError(null);
    setLecturaLocalError(null);
    setCargaRemotaCompletada(false);
    setCargando(Boolean(usuarioId));
    setHasMore(remotoDisponibleRef.current);
    setLoadingMore(false);
    setRefreshing(false);
    setDetalleVisible(false);
    setDetalle(null);
    setDetalleLoading(false);
    setDetalleFotoUrl('');
    setDetalleFotoCashInUrl('');
    setFotoDetalleActiva('activacion');
    setFotosPerdidas({});
    setCamaraReparacion(null);
    setHistorialOwnerId(usuarioId || null);
  }, [usuarioId]);

  useEffect(() => {
    if (usuarioId) {
      refrescarHistorial({ silent: false, desbloquearRemoto: true });
    }
  }, [usuarioId, refrescarHistorial]);

  // Realtime por usuario
  useEffect(() => {
    if (!usuarioId || !remotoDisponible) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`rt-activaciones-${usuarioId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activaciones', filter: `usuario_id=eq.${usuarioId}` },
        () => {
          refrescarHistorial({ silent: true });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [remotoDisponible, usuarioId, refrescarHistorial]);

  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState !== 'active' && nextState === 'active') {
        refrescarHistorial({ silent: true });
      }
    });
    return () => {
      appStateSub.remove();
    };
  }, [refrescarHistorial]);

  useEffect(() => {
    const anterior = conexionDisponibleRef.current;
    conexionDisponibleRef.current = remotoDisponible;
    if (!remotoDisponible) {
      setHasMore(false);
      setLoadingMore(false);
      return;
    }
    if (anterior === false) {
      remotoBloqueadoRef.current = false;
      refrescarHistorial({ silent: true, desbloquearRemoto: true });
    }
  }, [refrescarHistorial, remotoDisponible]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      localRequestIdRef.current += 1;
      refreshPendienteRef.current = null;
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refrescarHistorial({ silent: true, desbloquearRemoto: true });
  }, [refrescarHistorial]);

  const onEndReached = useCallback(() => {
    if (
      consultaControlRef.current.enCurso()
      || remotoBloqueadoRef.current
      || !remotoDisponibleRef.current
      || loadingMore
      || !hasMore
      || cargando
    ) return;
    ejecutarConsulta(() => fetchPage({ reset: false }));
  }, [loadingMore, hasMore, cargando, ejecutarConsulta, fetchPage]);

  const historialError = lecturaLocalError || lastError;
  const sinConexion = isConnected === false || isInternetReachable === false;

  // ------ Detalle ------
  const abrirDetalle = async (item) => {
    try {
      setDetalleLoading(true);
      setDetalle(null);
      setDetalleFotoUrl('');
      setDetalleFotoCashInUrl('');
      setFotoDetalleActiva('activacion');
      setFotosPerdidas({});
      setDetalleVisible(true);

      const fotoRaw = item?.foto_url || '';
      const fotoEsLocal = esFotoLocal(fotoRaw);
      const esLocal = item?._origen === 'local' || item?.estado_sync === 'offline_pending' || fotoEsLocal;
      if (esLocal) {
        const cashInRaw = item?.foto_cash_in || '';
        const [fotoResult, cashInResult] = await Promise.all([
          resolverFotoDetalle(fotoRaw),
          resolverFotoDetalle(cashInRaw),
        ]);
        setDetalle(item);
        setDetalleFotoUrl(fotoResult.uri);
        setDetalleFotoCashInUrl(cashInResult.uri);
        setFotosPerdidas({
          foto_url: fotoResult.perdida,
          foto_cash_in: cashInResult.perdida,
        });
        setFotoDetalleActiva(fotoResult.uri ? 'activacion' : 'cash_in');
        return;
      }

      const { data, error } = await withTimeout(
        supabase
          .from('activaciones')
          .select('*')
          .eq('id', item?.id)
          .single(),
        QUERY_TIMEOUT_MS,
        'La señal está muy débil para cargar el detalle.'
      );

      if (error) {
        console.error('❌ Detalle error:', error);
        Alert.alert('Error', 'No se pudo cargar el detalle.');
        setDetalleVisible(false);
        return;
      }

      const [fotoUrl, fotoCashInUrl] = await Promise.all([resolverUrlDeFoto(data?.foto_url), resolverUrlDeFoto(data?.foto_cash_in)]);
      setDetalleFotoUrl(fotoUrl);
      setDetalleFotoCashInUrl(fotoCashInUrl);
      setFotoDetalleActiva(fotoUrl ? 'activacion' : 'cash_in');
      setDetalle(data);
    } catch (e) {
      console.error('❌ Detalle catch:', e);
      Alert.alert('Error', 'No se pudo cargar el detalle.');
      setDetalleVisible(false);
    } finally {
      setDetalleLoading(false);
    }
  };

  const cerrarDetalle = () => {
    setDetalleVisible(false);
    setDetalle(null);
    setDetalleFotoUrl('');
    setDetalleFotoCashInUrl('');
    setFotoDetalleActiva('activacion');
    setFotosPerdidas({});
  };

  const guardarFotoReparada = async (fieldName, uri, dimensions = {}, options = {}) => {
    if (!detalle?._id_local && !detalle?.id) return;
    const destino = await prepararImagenPersistente(uri, fieldName, {
      width: dimensions.width,
      height: dimensions.height,
      skipManipulation: options.skipManipulation === true,
      allowLargeSourceBytes: options.allowLargeSourceBytes === true,
    });
    const idLocal = detalle._id_local || detalle.id;
    const localPhotos = {
      ...(detalle._sync?.localPhotos || {}),
      [fieldName]: destino,
    };
    const patch = {
      [fieldName]: destino,
      estado_sync: 'offline_pending',
      _sync: {
        ...(detalle._sync || {}),
        status: 'pending',
        error: null,
        localPhotos,
      },
    };
    await persistirReemplazoFoto({
      destino,
      fieldName,
      patch,
      verificarArchivo: (fotoUri) => FileSystem.getInfoAsync(fotoUri, { size: true }),
      persistir: (fotoPatch) => actualizarFormularioLocal(idLocal, fotoPatch),
      releer: () => obtenerFormularioPorId(idLocal),
    });
    // La URI anterior se conserva aquí. La limpieza global es la única que
    // puede borrarla tras comprobar referencias en pendientes y borradores.
    const actualizado = { ...detalle, ...patch };
    setDetalle(actualizado);
    if (fieldName === 'foto_cash_in') {
      setDetalleFotoCashInUrl(destino);
      setFotoDetalleActiva('cash_in');
    } else {
      setDetalleFotoUrl(destino);
      setFotoDetalleActiva('activacion');
    }
    setFotosPerdidas((prev) => ({ ...prev, [fieldName]: false }));
    await cargarLocales();
    const result = await onSincronizar?.({ showAlerts: false, force: true, targetLocalId: idLocal });
    const sincronizada = Array.isArray(result?.syncedLocalIds)
      ? result.syncedLocalIds.includes(idLocal)
      : result?.status === 'synced' && result?.synced > 0;
    if (sincronizada) {
      Alert.alert('Activación sincronizada', 'La activación pendiente se sincronizó correctamente.');
      cerrarDetalle();
      await refrescarHistorial({ silent: true, desbloquearRemoto: true });
    } else {
      const detalleError = result?.errors?.[0] ? `\n\n${result.errors[0]}` : '';
      Alert.alert('Guardado local', enmascararMarcaVisible(`La foto se actualizó, pero la activación sigue pendiente de sincronización.${detalleError}`, usuario));
    }
  };

  const usarFotoReparada = async (uri, dimensions) => {
    const fieldName = camaraReparacion;
    setCamaraReparacion(null);
    if (!fieldName) return;
    try {
      await guardarFotoReparada(fieldName, uri, dimensions);
    } catch (error) {
      console.error('❌ No se pudo reparar la foto pendiente:', error?.message || error);
      const message = error?.photoCode
        ? `No se pudo actualizar la foto pendiente. (${error.photoCode})`
        : error?.message || 'No se pudo actualizar la foto pendiente.';
      Alert.alert('Error de foto', enmascararMarcaVisible(message, usuario));
    } finally {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  };

  const seleccionarFotoReparada = async (fieldName) => {
    if (galeriaOperacionRef.current) {
      Alert.alert('Foto en proceso', 'Espera a que termine la selección o el procesamiento anterior.');
      return;
    }
    let selectorFinalizado = false;
    let uriReducida = '';
    const operacionGaleria = { invalidada: false };
    galeriaOperacionRef.current = operacionGaleria;
    try {
      // Photo Picker del sistema: sin solicitud de permiso previa.
      const promesaNativa = ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: Platform.OS === 'android' ? 1 : 0.5,
        allowsEditing: false,
      });
      promesaNativa.catch(() => {});
      const result = await withTimeout(
        promesaNativa,
        GALLERY_TIMEOUT_MS,
        'La galería excedió el tiempo permitido.'
      );
      selectorFinalizado = true;
      if (operacionGaleria.invalidada) return;
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const uri = asset?.uri;
      if (!uri) {
        Alert.alert('Error', 'La ruta de imagen no es válida.');
        return;
      }
      const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(uri)?.[1]?.toLowerCase();
      if (extension && !['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(extension)) {
        Alert.alert('Error', 'Selecciona una foto válida (JPG o PNG).');
        return;
      }
      const infoArchivo = await withTimeout(
        FileSystem.getInfoAsync(uri, { size: true }),
        PHOTO_FILE_TIMEOUT_MS,
        'La lectura local de la foto excedió el tiempo permitido.'
      ).catch(() => null);
      if (infoArchivo && infoArchivo.exists === false) {
        Alert.alert('Error', 'No se pudo leer la imagen seleccionada.');
        return;
      }
      const size = typeof asset?.fileSize === 'number'
        ? asset.fileSize
        : infoArchivo?.size;
      if (typeof size === 'number' && size <= 0) {
        Alert.alert('Error', 'La imagen seleccionada está vacía.');
        return;
      }
      const evaluacionDimensiones = evaluarDimensionesCaptura({
        width: asset.width,
        height: asset.height,
      });
      const resolucionExcesiva = evaluacionDimensiones.reason === 'too_large';
      const reducibleEnAndroid = resolucionExcesiva && puedeReducirImagenGaleria();
      const origenGrandeAndroid = Platform.OS === 'android' && !resolucionExcesiva;
      if (
        typeof size === 'number'
        && size / 1024 / 1024 > 6
        && !reducibleEnAndroid
        && !origenGrandeAndroid
      ) {
        Alert.alert('❌ Imagen demasiado grande', 'Selecciona una imagen más liviana (≤ 6 MB).');
        return;
      }
      if (reducibleEnAndroid) {
        const reduccion = await reducirImagenGaleria(uri, {
          maxSide: LADO_REDUCCION_GALERIA,
          quality: 0.5,
        });
        uriReducida = reduccion.uri;
        await guardarFotoReparada(fieldName, uriReducida, reduccion, { skipManipulation: true });
      } else {
        await guardarFotoReparada(fieldName, uri, {
          width: asset.width,
          height: asset.height,
          allowLargeSourceBytes: origenGrandeAndroid,
        });
      }
    } catch (error) {
      console.error('❌ No se pudo reparar la foto pendiente:', error?.message || error);
      if (!selectorFinalizado && operacionGaleria) operacionGaleria.invalidada = true;
      const selectorSigueActivo = !selectorFinalizado;
      const botonesReintentar = selectorSigueActivo
        ? [{ text: 'Cerrar', style: 'cancel' }]
        : [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Reintentar', onPress: () => seleccionarFotoReparada(fieldName) },
        ];
      const botonesElegirOtra = selectorSigueActivo
        ? [{ text: 'Cerrar', style: 'cancel' }]
        : [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Elegir otra', onPress: () => seleccionarFotoReparada(fieldName) },
        ];

      if (error?.photoReason === 'too_large') {
        Alert.alert(
          '❌ Imagen demasiado grande',
          'La foto supera 12 MP y no puede reducirse de forma segura en este dispositivo. Selecciona otra foto de menor resolución.',
          botonesElegirOtra
        );
        return;
      }
      if (error?.photoReason === 'downsample_timeout') {
        Alert.alert(
          'Tiempo de reducción agotado',
          error?.cancelConfirmed === false
            ? 'La reducción tardó demasiado y su cancelación aún puede estar finalizando. Espera unos segundos antes de reintentar.'
            : 'La reducción de la foto tardó demasiado y se canceló. Puedes intentarlo de nuevo.',
          botonesReintentar
        );
        return;
      }
      if (error?.photoReason === 'downsample_read') {
        Alert.alert(
          'No se pudo leer la foto',
          'El archivo puede haber sido movido, estar dañado o tener un formato no compatible. Elige otra foto o inténtalo de nuevo.',
          botonesElegirOtra
        );
        return;
      }
      if (error?.photoReason === 'downsample_process') {
        Alert.alert(
          'No se pudo procesar la foto',
          'Ocurrió un error al reducir la imagen en este dispositivo. Puedes intentarlo de nuevo.',
          botonesReintentar
        );
        return;
      }
      if (error?.photoReason === 'downsample_busy') {
        Alert.alert(
          'Foto en proceso',
          'Ya hay una reducción de imagen en curso. Espera a que termine antes de intentarlo de nuevo.',
          [{ text: 'Cerrar', style: 'cancel' }]
        );
        return;
      }
      if (error?.photoReason === 'downsample_cancelled') {
        Alert.alert(
          'Reducción cancelada',
          'La reducción de la foto se canceló. Puedes intentarlo de nuevo.',
          botonesReintentar
        );
        return;
      }
      if (
        error?.photoReason === 'downsample_unsupported'
        || error?.photoReason === 'downsample_argument'
      ) {
        Alert.alert(
          'No se pudo reducir la foto',
          enmascararMarcaVisible(error?.message || 'No se pudo preparar la reducción de la imagen.', usuario),
          [{ text: 'Cerrar', style: 'cancel' }]
        );
        return;
      }
      if (error?.photoCode) {
        Alert.alert('Error de foto', enmascararMarcaVisible(`No se pudo actualizar la foto pendiente. (${error.photoCode})`, usuario));
        return;
      }
      if (selectorFinalizado) {
        Alert.alert('Error', enmascararMarcaVisible(error?.message || 'No se pudo sincronizar la foto pendiente.', usuario));
        return;
      }
      const code = await registrarErrorFoto('gallery', error);
      Alert.alert(
        'Error de galería',
        enmascararMarcaVisible(
          selectorSigueActivo
            ? `No se pudo abrir la galería. (${code}) Cierra el selector y vuelve a intentarlo.`
            : `No se pudo abrir la galería. (${code})`,
          usuario
        ),
        selectorSigueActivo
          ? [{ text: 'Cerrar', style: 'cancel' }]
          : [
            { text: 'Cerrar', style: 'cancel' },
            { text: 'Reintentar', onPress: () => seleccionarFotoReparada(fieldName) },
          ]
      );
    } finally {
      if (galeriaOperacionRef.current === operacionGaleria) galeriaOperacionRef.current = null;
      if (uriReducida) {
        await FileSystem.deleteAsync(uriReducida, { idempotent: true }).catch(() => {});
      }
    }
  };

  const repararFotoPendiente = (fieldName) => {
    if (galeriaOperacionRef.current) {
      Alert.alert('Foto en proceso', 'Espera a que termine la selección o el procesamiento anterior.');
      return;
    }
    if (fieldName === 'foto_cash_in') {
      Alert.alert('Evidencia Cash-In', 'Selecciona el origen de la imagen.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Galería', onPress: () => seleccionarFotoReparada(fieldName) },
        { text: 'Cámara', onPress: () => setCamaraReparacion(fieldName) },
      ]);
      return;
    }
    setCamaraReparacion(fieldName);
  };

  const renderItem = ({ item }) => {
    const fecha = item.fecha_activacion || item.creado_en || item.created_at || '—';
    const tipo = enmascararMarcaVisible(item.tipo_activacion || '—', usuario);
    const esReactiv = !!item.es_reactivacion || !!item.reactivacion_comercio || /reactivaci[óo]n/i.test(tipo);
    const pendiente = item?._origen === 'local' || item?.estado_sync === 'offline_pending' || item?._sync?.status === 'pending';
    const cliente = enmascararMarcaVisible([item.nombres_cliente, item.apellidos_cliente].filter(Boolean).join(' ').trim(), usuario);
    const plazaVisible = enmascararMarcaVisible(etiquetaPlaza(item?.es_plaza_temporal ? item?.plaza_temporal : item?.plaza), usuario);
    const syncErrorText = pendiente ? enmascararMarcaVisible(item?._sync?.error, usuario) : '';
    const syncInfo = item?._sync || {};
    const intentoFecha = syncInfo.lastAttemptAt
      ? new Date(syncInfo.lastAttemptAt).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
      : 'no registrado';
    const intentoCodigo = syncInfo.lastAttemptCode
      || (syncInfo.lastAttemptResult === 'running' ? syncInfo.lastAttemptStage : null)
      || (syncInfo.lastAttemptResult === 'success' ? 'FOTO-OK' : null)
      || (syncErrorText ? 'HISTORICO' : null);
    const intentoVersion = syncInfo.lastAttemptVersionCode || 'no registrada';

    return (
      <TouchableOpacity onPress={() => abrirDetalle(item)} activeOpacity={0.75}>
        <View style={styles.item}>
          <View style={styles.itemTopRow}>
            <Text style={styles.itemDate}>{String(fecha).slice(0, 10)}</Text>
            <View
              style={[
                styles.estadoBadge,
                pendiente ? styles.estadoPending : esReactiv ? styles.estadoAccent : styles.estadoPrimary,
              ]}
            >
              <Text style={styles.estadoBadgeText}>
                {pendiente ? 'Pendiente sync' : esReactiv ? 'Reactivación' : 'Activación'}
              </Text>
            </View>
          </View>
          {!!cliente && <Text style={styles.itemTitle}>{cliente}</Text>}
          <Text style={styles.itemMeta}>Tipo: {tipo}</Text>
          {!!plazaVisible && <Text style={styles.itemMeta}>Plaza: {plazaVisible}</Text>}
          {!!syncErrorText && <Text style={styles.syncErrorText}>Error sync: {syncErrorText}</Text>}
          {pendiente && intentoCodigo && (
            <Text style={styles.syncAttemptText}>
              Código: {intentoCodigo}{'\n'}
              Último intento: {intentoFecha} · Versión: code {intentoVersion} · Intentos: {syncInfo.tries || 0}
            </Text>
          )}
          <Text style={styles.itemLink}>Ver detalle</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (!usuarioId || historialOwnerId !== usuarioId) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.text, { marginTop: spacing.sm }]}>Cargando usuario…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <Text style={styles.titulo}>Mis activaciones</Text>
        <Text style={styles.subtitulo}>
          {lecturaLocalError ? 'Registros locales sin verificar' : `${formularios.length} registro(s)`} · {periodoConsulta.etiqueta}
        </Text>
      </View>

      <View style={styles.periodCard}>
        <Text style={styles.periodTitle}>Período del historial</Text>
        <View style={styles.pickerShell}>
          <SelectorRN
            selectedValue={periodoSeleccionado}
            onValueChange={seleccionarPeriodo}
            accessibilityLabel={`Período del historial: ${periodoConsulta.etiqueta}`}
            options={opcionesPeriodo}
          />
        </View>
        <Text style={styles.periodLabel}>{periodoConsulta.etiqueta}</Text>
      </View>

      {cargando && formularios.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : formularios.length === 0 && historialError && (lecturaLocalError || !cargaRemotaCompletada) ? (
        <View style={styles.historyErrorBox}>
          <Text style={styles.emptyText}>No se pudo cargar el historial.</Text>
          <TouchableOpacity style={styles.historyRetryButton} onPress={onRefresh}>
            <Text style={styles.historyRetryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : formularios.length === 0 ? (
        <View>
          <Text style={styles.emptyText}>No hay activaciones en {periodoConsulta.etiqueta}.</Text>
          {sinConexion ? (
            <Text style={styles.historyWarning}>Sin conexión. No hay activaciones pendientes locales en este período.</Text>
          ) : historialError ? (
            <Text style={styles.historyWarning}>No se pudo actualizar el historial.</Text>
          ) : null}
        </View>
      ) : (
        <>
          {lecturaLocalError ? (
            <Text style={styles.historyWarning}>No se pudieron verificar las activaciones pendientes locales.</Text>
          ) : sinConexion ? (
            <Text style={styles.historyWarning}>Sin conexión. Mostrando los datos disponibles en el dispositivo.</Text>
          ) : lastError ? (
            <Text style={styles.historyWarning}>No se pudo actualizar. Mostrando los últimos datos disponibles.</Text>
          ) : null}
          <FlatList
            data={formularios}
            keyExtractor={(item) => String(item.id || item._id_local)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 100 }}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.3}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            ListFooterComponent={
              loadingMore ? (
                <View style={{ paddingVertical: spacing.md }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : null
            }
          />
        </>
      )}

      {/* Modal de Detalle */}
      <Modal
        visible={detalleVisible}
        animationType="slide"
        transparent
        onRequestClose={cerrarDetalle}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: modalMaxHeight }]}>
            <Text style={styles.modalTitulo}>Detalle de Activación</Text>

            {detalleLoading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : detalle ? (
              <ScrollView
                style={{ maxHeight: Math.max(220, modalMaxHeight - 140) }}
                showsVerticalScrollIndicator={false}
              >
                {(detalleFotoUrl || detalleFotoCashInUrl) ? (
                  <View style={styles.photoViewer}>
                    <View style={styles.photoTabs}>
                      {!!detalleFotoUrl && (
                        <TouchableOpacity
                          onPress={() => setFotoDetalleActiva('activacion')}
                          style={[styles.photoTab, fotoDetalleActiva === 'activacion' && styles.photoTabActive]}
                        >
                          <Text style={[styles.photoTabText, fotoDetalleActiva === 'activacion' && styles.photoTabTextActive]}>
                            Foto activación
                          </Text>
                        </TouchableOpacity>
                      )}
                      {!!detalleFotoCashInUrl && (
                        <TouchableOpacity
                          onPress={() => setFotoDetalleActiva('cash_in')}
                          style={[styles.photoTab, fotoDetalleActiva === 'cash_in' && styles.photoTabActive]}
                        >
                          <Text style={[styles.photoTabText, fotoDetalleActiva === 'cash_in' && styles.photoTabTextActive]}>
                            Foto Cash-In
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.photoLabel}>
                      {fotoDetalleActiva === 'cash_in' ? 'Evidencia Cash-In' : 'Evidencia de activación'}
                    </Text>
                    <Image
                      source={{ uri: fotoDetalleActiva === 'cash_in' ? detalleFotoCashInUrl : detalleFotoUrl }}
                      style={[styles.foto, { height: fotoHeight }]}
                      resizeMode="contain"
                    />
                  </View>
                ) : (
                  <Text style={styles.photoUnavailable}>Este registro no tiene fotografías disponibles.</Text>
                )}

                {(detalle?._origen === 'local' || detalle?.estado_sync === 'offline_pending' || detalle?._sync?.status === 'pending') ? (
                  <View style={styles.repairBox}>
                    <Text style={styles.repairText}>
                      {fotosPerdidas.foto_cash_in
                        ? 'La foto Cash-In ya no está en el dispositivo. Tómala nuevamente para sincronizar.'
                        : fotosPerdidas.foto_url
                          ? 'La foto de activación ya no está en el dispositivo. Tómala nuevamente para sincronizar.'
                          : 'Si una evidencia local se perdió, vuelve a tomarla para reintentar la sincronización.'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => repararFotoPendiente('foto_cash_in')}
                      style={[styles.repairButton, fotosPerdidas.foto_cash_in && styles.repairButtonWarning]}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.repairButtonText}>
                        {fotosPerdidas.foto_cash_in ? 'Tomar nuevamente foto Cash-In' : 'Reemplazar foto Cash-In'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => repararFotoPendiente('foto_url')}
                      style={[styles.repairButton, styles.repairButtonSecondary]}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.repairButtonText, styles.repairButtonTextSecondary]}>Reemplazar foto activación</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Campos principales */}
                {renderCampo('Fecha', (detalle.fecha_activacion || detalle.creado_en || detalle.created_at || '').toString().slice(0,10))}
                {renderCampo('Tipo de activación', detalle.tipo_activacion, usuario)}
                {renderCampo('Reactivación comercio', booleanPretty(!!detalle.es_reactivacion || !!detalle.reactivacion_comercio))}
                {renderCampo('Tipo de comercio', detalle.tipo_comercio, usuario)}
                {renderCampo('Tamaño de tienda', detalle.tamano_tienda, usuario)}
                {renderCampo('Tipo de tienda', detalle.tipo_tienda, usuario)}
                {renderCampo('Rubro de comercio', detalle.rubro_comercio, usuario)}
                {renderCampo('Otro rubro', detalle.rubro_comercio_otro, usuario)}
                {renderCampo('Comercio fuera del mercado', detalle.comercio_fuera_mercado == null ? null : booleanPretty(detalle.comercio_fuera_mercado))}
                {renderCampo('Cliente', [detalle.nombres_cliente, detalle.apellidos_cliente].filter(Boolean).join(' ').trim(), usuario)}
                {renderCampo('CI', detalle.ci_cliente, usuario)}
                {renderCampo('Teléfono', detalle.telefono_cliente, usuario)}
                {renderCampo('Email', detalle.email_cliente, usuario)}
                {renderCampo('Plaza', etiquetaPlaza(detalle.plaza), usuario)}
                {renderCampo('Plaza temporal', detalle.es_plaza_temporal ? etiquetaPlaza(detalle.plaza_temporal) : null, usuario)}
                {renderCampo('Impulsador', detalle.impulsador, usuario)}

                {/* Flags */}
                {renderCampo('Descargo app', booleanPretty(detalle.descargo_app))}
                {renderCampo('Registro', booleanPretty(detalle.registro))}
                {renderCampo('Cash in', booleanPretty(detalle.cash_in))}
                {renderCampo('Cash out', booleanPretty(detalle.cash_out))}
                {renderCampo('P2P', booleanPretty(detalle.p2p))}
                {renderCampo('QR físico', booleanPretty(detalle.qr_fisico))}
                {renderCampo('Respaldo', booleanPretty(detalle.respaldo))}
                {renderCampo('¿Hubo error?', booleanPretty(detalle.hubo_error))}
                {!!detalle.hubo_error && renderCampo('Tipo de error', detalle.tipo_error, usuario)}
                {!!detalle.hubo_error && renderCampo('Descripción de error', detalle.descripcion_error, usuario)}

                {/* Ubicación */}
                {(detalle.latitud || detalle.longitud) && renderCampo('Ubicación', `${detalle.latitud ?? '—'}, ${detalle.longitud ?? '—'}`)}
              </ScrollView>
            ) : (
              <Text style={styles.emptyText}>No se encontró el detalle.</Text>
            )}

            <TouchableOpacity onPress={cerrarDetalle} style={styles.btnCerrar}>
              <Text style={styles.btnCerrarTxt}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <CameraEvidencia
        visible={!!camaraReparacion}
        label={camaraReparacion === 'foto_cash_in' ? 'Evidencia Cash-In' : 'Evidencia de activación'}
        onCancel={() => setCamaraReparacion(null)}
        onUse={usarFotoReparada}
      />
    </View>
  );
}

/** Helpers de UI */
function renderCampo(label, value, usuario) {
  if (value === null || value === undefined || value === '') return null;
  const valorVisible = enmascararDatoCliente(label, value);
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: fontSizes.small, color: colors.textMuted, fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: fontSizes.medium, color: colors.text, fontWeight: '600' }}>{enmascararMarcaVisible(valorVisible, usuario)}</Text>
    </View>
  );
}
function booleanPretty(v) {
  return v === true ? 'Sí' : v === false ? 'No' : '—';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  headerCard: {
    backgroundColor: colors.headerBg,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#08131F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 9,
    elevation: 4,
  },
  titulo: {
    fontSize: fontSizes.large,
    fontWeight: '700',
    color: colors.headerText,
  },
  subtitulo: {
    marginTop: 4,
    color: '#CDDBEA',
    fontSize: fontSizes.small,
  },
  periodCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  periodTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  pickerShell: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    overflow: 'hidden',
  },
  periodLabel: {
    color: colors.text,
    fontSize: fontSizes.small,
    fontWeight: '800',
    textAlign: 'center',
  },
  item: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    shadowColor: '#0D243A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 7,
    elevation: 2,
  },
  itemTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemDate: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    fontWeight: '600',
  },
  estadoBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  estadoPrimary: {
    backgroundColor: 'rgba(23, 105, 255, 0.14)',
  },
  estadoAccent: {
    backgroundColor: 'rgba(255, 138, 0, 0.2)',
  },
  estadoPending: {
    backgroundColor: 'rgba(216, 146, 22, 0.24)',
  },
  estadoBadgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  itemTitle: {
    color: colors.text,
    fontSize: fontSizes.medium,
    fontWeight: '700',
    marginBottom: 4,
  },
  itemMeta: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    marginBottom: 2,
  },
  syncErrorText: {
    color: colors.danger || '#B42318',
    fontSize: fontSizes.small,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  syncAttemptText: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    marginTop: spacing.xs,
  },
  itemLink: {
    color: colors.primary,
    fontSize: fontSizes.small,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  text: {
    color: colors.text,
    fontSize: fontSizes.small,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSizes.medium,
  },
  historyErrorBox: {
    alignItems: 'center',
    gap: spacing.md,
  },
  historyRetryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  historyRetryText: {
    color: colors.headerText,
    fontSize: fontSizes.small,
    fontWeight: '700',
  },
  historyWarning: {
    color: colors.warning,
    fontSize: fontSizes.small,
    marginBottom: spacing.sm,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: 600,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalTitulo: {
    fontSize: fontSizes.large,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  foto: {
    width: '100%',
    height: 220,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  photoViewer: {
    marginBottom: spacing.sm,
  },
  photoTabs: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  photoTab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginHorizontal: 3,
    paddingHorizontal: spacing.xs,
  },
  photoTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  photoTabText: {
    color: colors.text,
    fontSize: fontSizes.small,
    fontWeight: '700',
    textAlign: 'center',
  },
  photoTabTextActive: {
    color: '#FFFFFF',
  },
  photoLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    fontWeight: '700',
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  photoUnavailable: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  repairBox: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.background,
  },
  repairText: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    marginBottom: spacing.sm,
  },
  repairButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  repairButtonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  repairButtonWarning: {
    backgroundColor: colors.danger || '#B42318',
  },
  repairButtonText: {
    color: '#FFFFFF',
    fontSize: fontSizes.small,
    fontWeight: '700',
    textAlign: 'center',
  },
  repairButtonTextSecondary: {
    color: colors.primary,
  },
  btnCerrar: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  btnCerrarTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: fontSizes.medium,
  },
});
