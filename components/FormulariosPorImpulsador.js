import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, StyleSheet, RefreshControl, Alert,
  Modal, TouchableOpacity, Image, ScrollView, useWindowDimensions
} from 'react-native';
import { supabase } from '../lib/supabase';
import { resolverUrlDeFoto } from '../lib/upload';
import { obtenerFormulariosLocales } from '../lib/storage';
import { mismoNombreActivador, normalizarNombreVisible } from '../lib/identity';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

const PAGE_SIZE = 20;

export default function FormulariosPorImpulsador({ usuario }) {
  const [formulariosRemotos, setFormulariosRemotos] = useState([]);
  const [formulariosLocales, setFormulariosLocales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastError, setLastError] = useState(null);

  // Detalle
  const [detalleVisible, setDetalleVisible] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalleFotoUrl, setDetalleFotoUrl] = useState('');
  const [detalleFotoCashInUrl, setDetalleFotoCashInUrl] = useState('');
  const [fotoDetalleActiva, setFotoDetalleActiva] = useState('activacion');

  const pageRef = useRef(0);
  const channelRef = useRef(null);

  const usuarioId = usuario?.id;
  const usuarioNombre = normalizarNombreVisible(usuario?.nombre || '');
  const { height } = useWindowDimensions();
  const modalMaxHeight = Math.min(height * 0.85, 640);
  const fotoHeight = Math.min(height * 0.35, 260);

  const cargarLocales = useCallback(async () => {
    if (!usuarioId) return;
    try {
      const locales = await obtenerFormulariosLocales();
      const filtrados = (locales || []).filter((f) => {
        if (f?.usuario_id && f.usuario_id === usuarioId) return true;
        if (usuarioNombre && f?.impulsador && mismoNombreActivador(f.impulsador, usuarioNombre)) return true;
        return false;
      });
      setFormulariosLocales(filtrados);
    } catch (err) {
      console.warn('⚠️ No se pudieron cargar formularios locales:', err?.message || err);
      setFormulariosLocales([]);
    }
  }, [usuarioNombre, usuarioId]);

  const formularios = useMemo(() => {
    const remotos = Array.isArray(formulariosRemotos) ? formulariosRemotos : [];
    const remotosById = new Set(remotos.map((f) => String(f?.id || '')));

    const localesPendientes = (formulariosLocales || [])
      .filter((f) => {
        const id = String(f?.id || '');
        if (!id) return true;
        return !remotosById.has(id);
      })
      .map((f) => ({ ...f, _origen: 'local' }));

    const merged = [...localesPendientes, ...remotos];
    return merged.sort((a, b) => {
      const av = String(a?.fecha_activacion || a?._created_at || a?.created_at || a?.creado_en || '');
      const bv = String(b?.fecha_activacion || b?._created_at || b?.created_at || b?.creado_en || '');
      return bv.localeCompare(av);
    });
  }, [formulariosLocales, formulariosRemotos]);

  const fetchPage = useCallback(async ({ reset = false } = {}) => {
    if (!usuarioId) return;

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

      const { data, error } = await supabase
        .from('activaciones')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('fecha_activacion', { ascending: false })
        .range(from, Math.max(from, to));

      if (error) {
        console.error('❌ Supabase select error:', error);
        setLastError(error.message || String(error));
        if (reset) Alert.alert('Error', `No se pudieron cargar los formularios.\n${error.message || ''}`);
        if (reset) setFormulariosRemotos([]);
        setHasMore(false);
        return;
      }

      let rows = data || [];
      // Compatibilidad con registros antiguos sin usuario_id enlazado.
      if (reset && rows.length === 0 && usuarioNombre) {
        const { data: legacyRows, error: legacyError } = await supabase
          .from('activaciones')
          .select('*')
          .ilike('impulsador', usuarioNombre)
          .order('fecha_activacion', { ascending: false })
          .range(0, PAGE_SIZE - 1);
        if (!legacyError && Array.isArray(legacyRows) && legacyRows.length > 0) {
          rows = legacyRows.filter((item) => mismoNombreActivador(item?.impulsador, usuarioNombre));
        }
      }

      setFormulariosRemotos(prev => (reset ? rows : [...prev, ...rows]));

      const noMore = !rows || rows.length < PAGE_SIZE;
      setHasMore(!noMore);
      if (!noMore) pageRef.current += 1;
    } catch (err) {
      console.error('❌ FetchPage error:', err);
      setLastError(err?.message || String(err));
      if (reset) setFormulariosRemotos([]);
      setHasMore(false);
      if (reset) Alert.alert('Error', `No se pudieron cargar los formularios.\n${err?.message || ''}`);
    } finally {
      setCargando(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [usuarioId, usuarioNombre]);

  useEffect(() => {
    if (usuarioId) {
      cargarLocales();
      fetchPage({ reset: true });
    }
  }, [usuarioId, fetchPage, cargarLocales]);

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
          cargarLocales();
          fetchPage({ reset: true });
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
  }, [usuarioId, fetchPage, cargarLocales]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    cargarLocales();
    fetchPage({ reset: true });
  }, [fetchPage, cargarLocales]);

  const onEndReached = useCallback(() => {
    if (!loadingMore && hasMore && !cargando) {
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
      setDetalleVisible(true);

      const fotoRaw = item?.foto_url || '';
      const fotoEsLocal = /^(file|content):\/\//i.test(String(fotoRaw));
      const esLocal = item?._origen === 'local' || item?.estado_sync === 'offline_pending' || fotoEsLocal;
      if (esLocal) {
        const cashInRaw = item?.foto_cash_in || '';
        const cashInEsLocal = /^(file|content):\/\//i.test(String(cashInRaw));
        const [fotoUrl, cashInUrl] = await Promise.all([
          fotoEsLocal ? fotoRaw : resolverUrlDeFoto(fotoRaw),
          cashInEsLocal ? cashInRaw : resolverUrlDeFoto(cashInRaw),
        ]);
        setDetalle(item);
        setDetalleFotoUrl(fotoUrl);
        setDetalleFotoCashInUrl(cashInUrl);
        setFotoDetalleActiva(fotoUrl ? 'activacion' : 'cash_in');
        return;
      }

      const { data, error } = await supabase
        .from('activaciones')
        .select('*')
        .eq('id', item?.id)
        .single();

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
  };

  const renderItem = ({ item }) => {
    const fecha = item.fecha_activacion || item.creado_en || item.created_at || '—';
    const tipo = item.tipo_activacion || '—';
    const esReactiv = !!item.es_reactivacion || !!item.reactivacion_comercio || /reactivaci[óo]n/i.test(tipo);
    const pendiente = item?._origen === 'local' || item?.estado_sync === 'offline_pending' || item?._sync?.status === 'pending';
    const cliente = [item.nombres_cliente, item.apellidos_cliente].filter(Boolean).join(' ').trim();

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
          {!!item.plaza && <Text style={styles.itemMeta}>Plaza: {item.plaza}</Text>}
          <Text style={styles.itemLink}>Ver detalle</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (!usuarioId) {
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
      ) : formularios.length === 0 ? (
        <View>
          <Text style={styles.emptyText}>No hay formularios registrados.</Text>
          {lastError ? <Text style={[styles.emptyText, { marginTop: 6 }]}>⚠️ {lastError}</Text> : null}
        </View>
      ) : (
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

                {/* Campos principales */}
                {renderCampo('Fecha', (detalle.fecha_activacion || detalle.creado_en || detalle.created_at || '').toString().slice(0,10))}
                {renderCampo('Tipo de activación', detalle.tipo_activacion)}
                {renderCampo('Reactivación comercio', booleanPretty(!!detalle.es_reactivacion || !!detalle.reactivacion_comercio))}
                {renderCampo('Tipo de comercio', detalle.tipo_comercio)}
                {renderCampo('Tamaño de tienda', detalle.tamano_tienda)}
                {renderCampo('Tipo de tienda', detalle.tipo_tienda)}
                {renderCampo('Rubro de comercio', detalle.rubro_comercio)}
                {renderCampo('Otro rubro', detalle.rubro_comercio_otro)}
                {renderCampo('Comercio fuera del mercado', detalle.comercio_fuera_mercado == null ? null : booleanPretty(detalle.comercio_fuera_mercado))}
                {renderCampo('Cliente', [detalle.nombres_cliente, detalle.apellidos_cliente].filter(Boolean).join(' ').trim())}
                {renderCampo('CI', detalle.ci_cliente)}
                {renderCampo('Teléfono', detalle.telefono_cliente)}
                {renderCampo('Email', detalle.email_cliente)}
                {renderCampo('Plaza', detalle.plaza)}
                {renderCampo('Plaza temporal', detalle.es_plaza_temporal ? detalle.plaza_temporal : null)}
                {renderCampo('Impulsador', detalle.impulsador)}

                {/* Flags */}
                {renderCampo('Descargo app', booleanPretty(detalle.descargo_app))}
                {renderCampo('Registro', booleanPretty(detalle.registro))}
                {renderCampo('Cash in', booleanPretty(detalle.cash_in))}
                {renderCampo('Cash out', booleanPretty(detalle.cash_out))}
                {renderCampo('P2P', booleanPretty(detalle.p2p))}
                {renderCampo('QR físico', booleanPretty(detalle.qr_fisico))}
                {renderCampo('Respaldo', booleanPretty(detalle.respaldo))}
                {renderCampo('¿Hubo error?', booleanPretty(detalle.hubo_error))}
                {!!detalle.hubo_error && renderCampo('Tipo de error', detalle.tipo_error)}
                {!!detalle.hubo_error && renderCampo('Descripción de error', detalle.descripcion_error)}

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
    </View>
  );
}

/** Helpers de UI */
function renderCampo(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: fontSizes.small, color: colors.textMuted, fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: fontSizes.medium, color: colors.text, fontWeight: '600' }}>{String(value)}</Text>
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
