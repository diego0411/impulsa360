import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, StyleSheet, RefreshControl, Alert,
  Modal, TouchableOpacity, Image, ScrollView, useWindowDimensions
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

const PAGE_SIZE = 20;

export default function FormulariosPorImpulsador({ usuario }) {
  const [formularios, setFormularios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastError, setLastError] = useState(null);

  // Detalle
  const [detalleVisible, setDetalleVisible] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [detalleLoading, setDetalleLoading] = useState(false);

  const pageRef = useRef(0);
  const channelRef = useRef(null);

  const usuarioId = usuario?.id;
  const { height } = useWindowDimensions();
  const modalMaxHeight = Math.min(height * 0.85, 640);
  const fotoHeight = Math.min(height * 0.35, 260);

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
        if (reset) setFormularios([]);
        setHasMore(false);
        return;
      }

      setFormularios(prev => (reset ? (data || []) : [...prev, ...(data || [])]));

      const noMore = !data || data.length < PAGE_SIZE;
      setHasMore(!noMore);
      if (!noMore) pageRef.current += 1;
    } catch (err) {
      console.error('❌ FetchPage error:', err);
      setLastError(err?.message || String(err));
      if (reset) setFormularios([]);
      setHasMore(false);
      if (reset) Alert.alert('Error', `No se pudieron cargar los formularios.\n${err?.message || ''}`);
    } finally {
      setCargando(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [usuarioId]);

  useEffect(() => {
    if (usuarioId) fetchPage({ reset: true });
  }, [usuarioId, fetchPage]);

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
        () => fetchPage({ reset: true })
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [usuarioId, fetchPage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPage({ reset: true });
  }, [fetchPage]);

  const onEndReached = useCallback(() => {
    if (!loadingMore && hasMore && !cargando) {
      fetchPage({ reset: false });
    }
  }, [loadingMore, hasMore, cargando, fetchPage]);

  // ------ Detalle ------
  const abrirDetalle = async (id) => {
    try {
      setDetalleLoading(true);
      setDetalle(null);
      setDetalleVisible(true);

      const { data, error } = await supabase
        .from('activaciones')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('❌ Detalle error:', error);
        Alert.alert('Error', 'No se pudo cargar el detalle.');
        setDetalleVisible(false);
        return;
      }
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
  };

  const renderItem = ({ item }) => {
    const fecha = item.fecha_activacion || item.creado_en || item.created_at || '—';
    const tipo = item.tipo_activacion || '—';
    const esReactiv = !!item.reactivacion_comercio || /reactivaci[óo]n/i.test(tipo);
    const cliente = [item.nombres_cliente, item.apellidos_cliente].filter(Boolean).join(' ').trim();

    return (
      <TouchableOpacity onPress={() => abrirDetalle(item.id)} activeOpacity={0.75}>
        <View style={styles.item}>
          <Text style={styles.text}>📅 {String(fecha).slice(0, 10)}</Text>
          {!!cliente && <Text style={styles.text}>🧍 {cliente}</Text>}
          <Text style={styles.text}>
            📦 {tipo}{esReactiv ? ' · Reactivación' : ''}
          </Text>
          {!!item.plaza && <Text style={styles.text}>🏷️ Plaza: {item.plaza}</Text>}
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
      <Text style={styles.titulo}>📋 Mis Formularios Enviados</Text>

      {cargando && formularios.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : formularios.length === 0 ? (
        <View>
          <Text style={styles.text}>No hay formularios registrados.</Text>
          {lastError ? <Text style={[styles.text, { marginTop: 6 }]}>⚠️ {lastError}</Text> : null}
        </View>
      ) : (
        <FlatList
          data={formularios}
          keyExtractor={(item) => String(item.id)}
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
                {/* Foto si hay */}
                {!!detalle.foto_url && (
                  <Image
                    source={{ uri: detalle.foto_url }}
                    style={[styles.foto, { height: fotoHeight }]}
                  />
                )}

                {/* Campos principales */}
                {renderCampo('Fecha', (detalle.fecha_activacion || detalle.creado_en || detalle.created_at || '').toString().slice(0,10))}
                {renderCampo('Tipo de activación', detalle.tipo_activacion)}
                {renderCampo('Reactivación comercio', detalle.reactivacion_comercio ? 'Sí' : 'No')}
                {renderCampo('Tipo de comercio', detalle.tipo_comercio)}
                {renderCampo('Tamaño de tienda', detalle.tamano_tienda)}
                {renderCampo('Cliente', [detalle.nombres_cliente, detalle.apellidos_cliente].filter(Boolean).join(' ').trim())}
                {renderCampo('CI', detalle.ci_cliente)}
                {renderCampo('Teléfono', detalle.telefono_cliente)}
                {renderCampo('Email', detalle.email_cliente)}
                {renderCampo('Plaza', detalle.plaza)}
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
                {!!detalle.hubo_error && renderCampo('Descripción de error', detalle.descripcion_error)}

                {/* Ubicación */}
                {(detalle.latitud || detalle.longitud) && renderCampo('Ubicación', `${detalle.latitud ?? '—'}, ${detalle.longitud ?? '—'}`)}
              </ScrollView>
            ) : (
              <Text style={styles.text}>No se encontró el detalle.</Text>
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
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontSize: fontSizes.small, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: fontSizes.medium, color: colors.text }}>{String(value)}</Text>
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
  text: {
    color: colors.text,
    fontSize: fontSizes.small,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: 600,
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
  },
  btnCerrar: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
  },
  btnCerrarTxt: {
    color: '#fff',
    fontWeight: '600',
    fontSize: fontSizes.medium,
  },
});
