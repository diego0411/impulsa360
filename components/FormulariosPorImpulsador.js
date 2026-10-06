import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, StyleSheet, RefreshControl, Alert,
  AppState, Modal, TouchableOpacity, Image, ScrollView, useWindowDimensions
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { prepararImagenPersistente, resolverUrlDeFoto } from '../lib/upload';
import { actualizarFormularioLocal, obtenerFormulariosLocales } from '../lib/storage';
import { mismoNombreActivador, normalizarNombreVisible } from '../lib/identity';
import { etiquetaPlaza } from '../lib/plazas';
import { fechaEnRango, fechaLocalIso, obtenerQuincenaActual } from '../lib/quincena';
import { withTimeout } from '../lib/asyncTimeout';
import { enmascararMarcaVisible } from '../lib/brandMask';
import { enmascararDatoCliente } from '../lib/customerMask';
import { colors, spacing, fontSizes, radius } from '../styles/theme';
import CameraEvidencia from './CameraEvidencia';
import { registrarErrorFoto } from '../lib/photoDiagnostics';

const PAGE_SIZE = 20;
const QUERY_TIMEOUT_MS = 10000;
const GALLERY_TIMEOUT_MS = 30000;
const PHOTO_FILE_TIMEOUT_MS = 12000;
const esFotoLocal = (value) => /^(file|content):\/\//i.test(String(value || ''));
const esPendienteSync = (item) => item?._origen === 'local' || item?.estado_sync === 'offline_pending' || item?._sync?.status === 'pending';
const fechaRealActivacion = (item) => item?.fecha_activacion || item?._created_at || item?.created_at || item?.creado_en;
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
const combinarRemotosSinDuplicados = (anteriores = [], nuevos = []) => {
  const resultado = [];
  const ids = new Set();
  [...anteriores, ...nuevos].forEach((item) => {
    const id = String(item?.id || item?._id_local || '');
    if (id && ids.has(id)) return;
    if (id) ids.add(id);
    resultado.push(item);
  });
  return resultado;
};
const claveFormulario = (item) => String(item?.id || item?._id_local || '');

const resolverFotoDetalle = async (value) => {
  if (!value) return { uri: '', perdida: false };
  if (!esFotoLocal(value)) {
    return { uri: await resolverUrlDeFoto(value), perdida: false };
  }

  const info = await FileSystem.getInfoAsync(value, { size: true }).catch(() => null);
  return { uri: info?.exists ? value : '', perdida: !info?.exists };
};

export default function FormulariosPorImpulsador({ usuario, onSincronizar }) {
  const usuarioId = usuario?.id;
  const [formulariosRemotos, setFormulariosRemotos] = useState([]);
  const [formulariosLocales, setFormulariosLocales] = useState([]);
  const [historialOwnerId, setHistorialOwnerId] = useState(usuarioId || null);
  const [cargando, setCargando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastError, setLastError] = useState(null);
  const [cargaRemotaCompletada, setCargaRemotaCompletada] = useState(false);

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
  const refreshEnCursoRef = useRef(null);
  const refreshOwnerRef = useRef(null);
  const refreshPendienteRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const conexionDisponibleRef = useRef(null);
  const mountedRef = useRef(true);
  const ownerActualRef = useRef(usuarioId || null);
  const localesActualesRef = useRef({ ownerId: usuarioId || null, rows: [] });
  const localesAusentesConfirmacionesRef = useRef(new Map());
  ownerActualRef.current = usuarioId || null;
  const hoyLocal = fechaLocalIso(new Date());
  const rangoQuincena = useMemo(() => obtenerQuincenaActual(new Date(`${hoyLocal}T12:00:00`)), [hoyLocal]);

  const usuarioNombre = normalizarNombreVisible(usuario?.nombre || '');
  const administrador = rolesDeUsuario(usuario).some(esRolAdministrador);
  const { height } = useWindowDimensions();
  const modalMaxHeight = Math.min(height * 0.85, 640);
  const fotoHeight = Math.min(height * 0.35, 260);

  const cargarLocales = useCallback(async () => {
    if (!usuarioId) return;
    const ownerId = usuarioId;
    const requestId = ++localRequestIdRef.current;
    try {
      const locales = await obtenerFormulariosLocales();
      if (
        !mountedRef.current
        || ownerActualRef.current !== ownerId
        || requestId !== localRequestIdRef.current
      ) return;
      const filtrados = (locales || []).filter((f) => f?.usuario_id === ownerId);
      localesActualesRef.current = { ownerId, rows: filtrados };
      setFormulariosLocales((prev) => combinarRemotosSinDuplicados(filtrados, prev));
    } catch (err) {
      console.warn('⚠️ No se pudieron cargar formularios locales:', err?.message || err);
      // Un fallo transitorio no reemplaza pendientes válidos ya visibles.
    }
  }, [usuarioId]);

  const formularios = useMemo(() => {
    const remotos = Array.isArray(formulariosRemotos) ? formulariosRemotos : [];
    const remotosById = new Set(remotos.map((f) => String(f?.id || '')));

    const localesPendientes = (formulariosLocales || [])
      .filter((f) => {
        if (!administrador && !fechaEnRango(fechaRealActivacion(f), rangoQuincena)) return false;
        if (!esPendienteSync(f) && !administrador) return false;
        const id = String(f?.id || '');
        if (!id) return true;
        return !remotosById.has(id);
      })
      .map((f) => ({ ...f, _origen: 'local' }));

    const merged = [...localesPendientes, ...remotos];
    return merged.sort((a, b) => {
      const av = String(fechaRealActivacion(a) || '');
      const bv = String(fechaRealActivacion(b) || '');
      return bv.localeCompare(av);
    });
  }, [administrador, formulariosLocales, formulariosRemotos, rangoQuincena]);

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
          .range(from, Math.max(from, to));
      if (!administrador) {
        query = query
          .gte('fecha_activacion', rangoQuincena.desde)
          .lt('fecha_activacion', rangoQuincena.hastaExclusivo);
      }

      const { data, error } = await withTimeout(
        query,
        QUERY_TIMEOUT_MS,
        'La señal está muy débil para cargar activaciones.'
      );

      if (error) {
        console.error('❌ Supabase select error:', error);
        if (!mountedRef.current || ownerActualRef.current !== ownerId || requestId !== requestIdRef.current) return;
        setLastError(error.message || String(error));
        if (reset && !silent) Alert.alert('Error', enmascararMarcaVisible(`No se pudieron actualizar los formularios.\n${error.message || ''}`, usuario));
        return;
      }

      let rows = data || [];
      // Compatibilidad con registros antiguos sin usuario_id enlazado.
      if (reset && rows.length === 0 && usuarioNombre) {
        let legacyQuery = supabase
            .from('activaciones')
            .select('*')
            .ilike('impulsador', usuarioNombre)
            .order('fecha_activacion', { ascending: false })
            .range(0, PAGE_SIZE - 1);
        if (!administrador) {
          legacyQuery = legacyQuery
            .gte('fecha_activacion', rangoQuincena.desde)
            .lt('fecha_activacion', rangoQuincena.hastaExclusivo);
        }
        const { data: legacyRows, error: legacyError } = await withTimeout(
          legacyQuery,
          QUERY_TIMEOUT_MS,
          'La señal está muy débil para cargar activaciones.'
        );
        if (!legacyError && Array.isArray(legacyRows) && legacyRows.length > 0) {
          rows = legacyRows.filter((item) => mismoNombreActivador(item?.impulsador, usuarioNombre));
        }
      }

      if (!mountedRef.current || ownerActualRef.current !== ownerId || requestId !== requestIdRef.current) return;
      setFormulariosRemotos((prev) => (reset ? combinarRemotosSinDuplicados([], rows) : combinarRemotosSinDuplicados(prev, rows)));
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
          return combinarRemotosSinDuplicados(localesActuales, retenidos);
        });
      }
      setCargaRemotaCompletada(true);

      const noMore = !rows || rows.length < PAGE_SIZE;
      setHasMore(!noMore);
      if (!noMore) pageRef.current += 1;
    } catch (err) {
      console.error('❌ FetchPage error:', err);
      if (!mountedRef.current || ownerActualRef.current !== ownerId || requestId !== requestIdRef.current) return;
      setLastError(err?.message || String(err));
      if (reset && !silent) Alert.alert('Error', enmascararMarcaVisible(`No se pudieron actualizar los formularios.\n${err?.message || ''}`, usuario));
    } finally {
      if (!mountedRef.current || ownerActualRef.current !== ownerId || requestId !== requestIdRef.current) return;
      setCargando(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [administrador, rangoQuincena, usuario, usuarioId, usuarioNombre]);

  const refrescarHistorial = useCallback(({ silent = true } = {}) => {
    const ownerId = usuarioId;
    if (!ownerId || ownerActualRef.current !== ownerId) return Promise.resolve();
    if (refreshEnCursoRef.current && refreshOwnerRef.current === ownerId) {
      refreshPendienteRef.current = true;
      return refreshEnCursoRef.current;
    }

    const run = cargarLocales().then(() => {
      if (ownerActualRef.current !== ownerId) return;
      return fetchPage({ reset: true, silent });
    });
    const tracked = run.finally(() => {
      if (refreshEnCursoRef.current !== tracked || refreshOwnerRef.current !== ownerId) return;
      refreshEnCursoRef.current = null;
      refreshOwnerRef.current = null;
      if (refreshPendienteRef.current && mountedRef.current && ownerActualRef.current === ownerId) {
        refreshPendienteRef.current = false;
        globalThis.setTimeout(() => refrescarHistorial({ silent: true }), 0);
      }
    });
    refreshEnCursoRef.current = tracked;
    refreshOwnerRef.current = ownerId;
    return tracked;
  }, [cargarLocales, fetchPage, usuarioId]);

  useEffect(() => {
    requestIdRef.current += 1;
    localRequestIdRef.current += 1;
    refreshEnCursoRef.current = null;
    refreshOwnerRef.current = null;
    refreshPendienteRef.current = false;
    if (galeriaOperacionRef.current) galeriaOperacionRef.current.invalidada = true;
    galeriaOperacionRef.current = null;
    localesActualesRef.current = { ownerId: usuarioId || null, rows: [] };
    localesAusentesConfirmacionesRef.current.clear();
    pageRef.current = 0;
    setFormulariosRemotos([]);
    setFormulariosLocales([]);
    setLastError(null);
    setCargaRemotaCompletada(false);
    setCargando(Boolean(usuarioId));
    setHasMore(true);
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
      refrescarHistorial({ silent: false });
    }
  }, [usuarioId, refrescarHistorial]);

  // Realtime por usuario
  useEffect(() => {
    if (!usuarioId) return;

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
  }, [usuarioId, refrescarHistorial]);

  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState !== 'active' && nextState === 'active') {
        refrescarHistorial({ silent: true });
      }
    });
    const netInfoSub = NetInfo.addEventListener((state) => {
      const disponible = !!state?.isConnected && state?.isInternetReachable !== false;
      const anterior = conexionDisponibleRef.current;
      conexionDisponibleRef.current = disponible;
      if (anterior === false && disponible) refrescarHistorial({ silent: true });
    });
    return () => {
      appStateSub.remove();
      netInfoSub();
    };
  }, [refrescarHistorial]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      localRequestIdRef.current += 1;
      refreshEnCursoRef.current = null;
      refreshOwnerRef.current = null;
      refreshPendienteRef.current = false;
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refrescarHistorial({ silent: true });
  }, [refrescarHistorial]);

  const onEndReached = useCallback(() => {
    if (!refreshEnCursoRef.current && !loadingMore && hasMore && !cargando) {
      fetchPage({ reset: false });
    }
  }, [loadingMore, hasMore, cargando, fetchPage]);

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

  const guardarFotoReparada = async (fieldName, uri) => {
    if (!detalle?._id_local && !detalle?.id) return;
    const destino = await prepararImagenPersistente(uri, fieldName);
    const idLocal = detalle._id_local || detalle.id;
    const localPhotos = {
      ...(detalle._sync?.localPhotos || {}),
      [fieldName]: destino,
    };
    const anterior = detalle[fieldName];
    if (/^file:\/\//i.test(String(anterior || '')) && anterior !== destino) {
      await FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => {});
    }
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
    await actualizarFormularioLocal(idLocal, patch);
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
      await cargarLocales();
      await fetchPage({ reset: true });
    } else {
      const detalleError = result?.errors?.[0] ? `\n\n${result.errors[0]}` : '';
      Alert.alert('Guardado local', enmascararMarcaVisible(`La foto se actualizó, pero la activación sigue pendiente de sincronización.${detalleError}`, usuario));
    }
  };

  const usarFotoReparada = async (uri) => {
    const fieldName = camaraReparacion;
    setCamaraReparacion(null);
    if (!fieldName) return;
    try {
      await guardarFotoReparada(fieldName, uri);
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
      Alert.alert('Galería ocupada', 'Espera a que termine la selección anterior o cierra el selector abierto.');
      return;
    }
    let selectorFinalizado = false;
    let operacionGaleria = null;
    try {
      // Photo Picker del sistema: sin solicitud de permiso previa.
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
      const uri = result.assets?.[0]?.uri;
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
      const size = typeof result.assets?.[0]?.fileSize === 'number'
        ? result.assets[0].fileSize
        : infoArchivo?.size;
      if (typeof size === 'number' && size <= 0) {
        Alert.alert('Error', 'La imagen seleccionada está vacía.');
        return;
      }
      if (typeof size === 'number' && size / 1024 / 1024 > 6) {
        Alert.alert('❌ Imagen demasiado grande', 'Selecciona una imagen más liviana (≤ 6 MB).');
        return;
      }
      await guardarFotoReparada(fieldName, uri);
    } catch (error) {
      console.error('❌ No se pudo reparar la foto pendiente:', error?.message || error);
      if (!selectorFinalizado && operacionGaleria) operacionGaleria.invalidada = true;
      if (error?.photoCode) {
        Alert.alert('Error de foto', enmascararMarcaVisible(`No se pudo actualizar la foto pendiente. (${error.photoCode})`, usuario));
        return;
      }
      if (selectorFinalizado) {
        Alert.alert('Error', enmascararMarcaVisible(error?.message || 'No se pudo sincronizar la foto pendiente.', usuario));
        return;
      }
      const code = await registrarErrorFoto('gallery', error);
      const operacionSigueActiva = galeriaOperacionRef.current === operacionGaleria;
      Alert.alert(
        'Error de galería',
        enmascararMarcaVisible(
          operacionSigueActiva
            ? `No se pudo abrir la galería. (${code}) Cierra el selector y vuelve a intentarlo.`
            : `No se pudo abrir la galería. (${code})`,
          usuario
        ),
        operacionSigueActiva
          ? [{ text: 'Cerrar', style: 'cancel' }]
          : [
            { text: 'Cerrar', style: 'cancel' },
            { text: 'Reintentar', onPress: () => seleccionarFotoReparada(fieldName) },
          ]
      );
    }
  };

  const repararFotoPendiente = (fieldName) => {
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
        <Text style={styles.subtitulo}>{formularios.length} registro(s) cargados</Text>
      </View>

      {cargando && formularios.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : formularios.length === 0 && lastError && !cargaRemotaCompletada ? (
        <View style={styles.historyErrorBox}>
          <Text style={styles.emptyText}>No se pudo cargar el historial.</Text>
          <TouchableOpacity style={styles.historyRetryButton} onPress={onRefresh}>
            <Text style={styles.historyRetryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : formularios.length === 0 ? (
        <View>
          <Text style={styles.emptyText}>No hay formularios registrados.</Text>
          {lastError ? (
            <Text style={styles.historyWarning}>No se pudo actualizar el historial.</Text>
          ) : null}
        </View>
      ) : (
        <>
          {lastError ? (
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
