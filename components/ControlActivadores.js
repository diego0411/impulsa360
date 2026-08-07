import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { normalizarNombreVisible } from '../lib/identity';
import { resolverUrlDeFoto } from '../lib/upload';
import { colors, fontSizes, radius, spacing } from '../styles/theme';

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

const claveDetalle = (equipoId, activadorId) => `${equipoId}:${activadorId}`;
const nombreVisible = (value, fallback) => normalizarNombreVisible(value || '') || fallback;
const fechaVisible = (item) => String(item?.fecha_activacion || item?.created_at || '').slice(0, 10) || 'Sin fecha';
const resumirActivadores = (activadores) => (activadores || []).reduce((resumen, activador) => ({
  activadores: resumen.activadores + 1,
  hoy: resumen.hoy + Number(activador?.hoy || 0),
  semana: resumen.semana + Number(activador?.semana || 0),
  mes: resumen.mes + Number(activador?.mes || 0),
  total: resumen.total + Number(activador?.total || 0),
}), { activadores: 0, hoy: 0, semana: 0, mes: 0, total: 0 });

const agruparJerarquia = (rows) => {
  const lideres = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const liderId = row?.lider_id;
    const equipoId = row?.equipo_id;
    if (!liderId || !equipoId) return;

    if (!lideres.has(liderId)) {
      lideres.set(liderId, {
        id: liderId,
        nombre: nombreVisible(row?.lider_nombre, 'Líder sin nombre'),
        equipos: new Map(),
      });
    }
    const lider = lideres.get(liderId);

    if (!lider.equipos.has(equipoId)) {
      lider.equipos.set(equipoId, {
        id: equipoId,
        numero: row?.equipo_numero,
        nombre: nombreVisible(row?.equipo_nombre, 'Equipo sin nombre'),
        activadores: [],
      });
    }

    if (row?.activador_id) {
      lider.equipos.get(equipoId).activadores.push({
        id: row.activador_id,
        nombre: nombreVisible(row?.activador_nombre, 'Activador sin nombre'),
        hoy: Number(row?.hoy || 0),
        semana: Number(row?.semana || 0),
        mes: Number(row?.mes || 0),
        total: Number(row?.total || 0),
      });
    }
  });

  return [...lideres.values()]
    .map((lider) => ({
      ...lider,
      equipos: [...lider.equipos.values()]
        .map((equipo) => ({
          ...equipo,
          activadores: equipo.activadores.sort((a, b) => a.nombre.localeCompare(b.nombre)),
        }))
        .sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0) || a.nombre.localeCompare(b.nombre)),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
};

export default function ControlActivadores({ usuario, isConnected }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [abiertos, setAbiertos] = useState({});
  const [detalles, setDetalles] = useState({});
  const [detalleLoading, setDetalleLoading] = useState({});
  const [detalleErrores, setDetalleErrores] = useState({});
  const [foto, setFoto] = useState(null);
  const [fotoLoading, setFotoLoading] = useState(false);
  const [fotoError, setFotoError] = useState('');
  const { height } = useWindowDimensions();
  const administrador = esRolAdministrador(usuario?.rol || usuario?.role);

  const cargar = useCallback(async ({ manual = false } = {}) => {
    if (!isConnected) {
      setError('Conéctate a internet para actualizar Control Activadores.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (manual) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const { data, error: queryError } = await supabase.rpc('control_activadores_jerarquia', {
        p_desde: null,
        p_hasta: null,
      });
      if (queryError) throw queryError;
      setRows(Array.isArray(data) ? data : []);
      if (manual) {
        setDetalles({});
        setDetalleErrores({});
      }
    } catch (e) {
      setError(e?.message || 'No se pudo cargar la jerarquía de activadores.');
      if (!manual) setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isConnected]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const jerarquia = useMemo(() => agruparJerarquia(rows), [rows]);

  const alternar = useCallback((key) => {
    setAbiertos((actual) => ({ ...actual, [key]: !actual[key] }));
  }, []);

  const alternarActivaciones = useCallback(async (equipoId, activadorId) => {
    const key = claveDetalle(equipoId, activadorId);
    if (abiertos[key]) {
      alternar(key);
      return;
    }

    setAbiertos((actual) => ({ ...actual, [key]: true }));
    if (Object.prototype.hasOwnProperty.call(detalles, key) || detalleLoading[key]) return;

    setDetalleLoading((actual) => ({ ...actual, [key]: true }));
    setDetalleErrores((actual) => ({ ...actual, [key]: '' }));
    try {
      const { data, error: queryError } = await supabase.rpc('control_activaciones_detalle', {
        p_activador_id: activadorId,
        p_equipo_id: equipoId,
        p_desde: null,
        p_hasta: null,
      });
      if (queryError) throw queryError;
      setDetalles((actual) => ({ ...actual, [key]: Array.isArray(data) ? data : [] }));
    } catch (e) {
      setDetalleErrores((actual) => ({
        ...actual,
        [key]: e?.message || 'No se pudieron cargar las activaciones.',
      }));
    } finally {
      setDetalleLoading((actual) => ({ ...actual, [key]: false }));
    }
  }, [abiertos, detalleLoading, detalles, alternar]);

  const abrirFoto = useCallback(async (ruta, titulo) => {
    if (!ruta) return;
    setFoto({ titulo, uri: '' });
    setFotoLoading(true);
    setFotoError('');
    try {
      const uri = await resolverUrlDeFoto(ruta);
      if (!uri) throw new Error('La evidencia no está disponible.');
      setFoto({ titulo, uri });
    } catch (e) {
      setFotoError(e?.message || 'No se pudo abrir la evidencia.');
    } finally {
      setFotoLoading(false);
    }
  }, []);

  const renderActivacion = (item) => {
    const cliente = [item?.nombres_cliente, item?.apellidos_cliente].filter(Boolean).join(' ').trim();
    return (
      <View key={item.id} style={styles.activationCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.activationDate}>{fechaVisible(item)}</Text>
          <Text style={styles.activationType}>{item?.tipo_activacion || 'Activación'}</Text>
        </View>
        {!!cliente && <Text style={styles.activationClient}>{cliente}</Text>}
        {!!item?.plaza && <Text style={styles.meta}>Plaza: {item.plaza}</Text>}
        {(item?.foto_url || item?.foto_cash_in) ? (
          <View style={styles.evidenceRow}>
            {!!item.foto_url && (
              <TouchableOpacity style={styles.evidenceButton} onPress={() => abrirFoto(item.foto_url, 'Evidencia de activación')}>
                <Text style={styles.evidenceText}>Foto activación</Text>
              </TouchableOpacity>
            )}
            {!!item.foto_cash_in && (
              <TouchableOpacity style={styles.evidenceButton} onPress={() => abrirFoto(item.foto_cash_in, 'Evidencia Cash-In')}>
                <Text style={styles.evidenceText}>Foto Cash-In</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : <Text style={styles.meta}>Sin evidencias fotográficas.</Text>}
      </View>
    );
  };

  const renderActivador = (equipo, activador) => {
    const key = claveDetalle(equipo.id, activador.id);
    const abierto = !!abiertos[key];
    const activaciones = detalles[key] || [];
    return (
      <View key={activador.id} style={styles.activatorCard}>
        <TouchableOpacity onPress={() => alternarActivaciones(equipo.id, activador.id)} activeOpacity={0.75}>
          <View style={styles.rowBetween}>
            <Text style={styles.activatorName}>{activador.nombre}</Text>
            <Text style={styles.chevron}>{abierto ? '▲' : '▼'}</Text>
          </View>
          <View style={styles.metricsRow}>
            {[['Hoy', activador.hoy], ['Semana', activador.semana], ['Mes', activador.mes], ['Total', activador.total]].map(([label, value]) => (
              <View key={label} style={styles.metric}>
                <Text style={styles.metricValue}>{value}</Text>
                <Text style={styles.metricLabel}>{label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.actionText}>{abierto ? 'Ocultar activaciones' : 'Ver activaciones'}</Text>
        </TouchableOpacity>
        {abierto && (
          <View style={styles.activationsContainer}>
            {detalleLoading[key] ? (
              <ActivityIndicator color={colors.primary} />
            ) : detalleErrores[key] ? (
              <Text style={styles.inlineError}>{detalleErrores[key]}</Text>
            ) : activaciones.length === 0 ? (
              <Text style={styles.emptyInline}>No hay activaciones atribuibles a este equipo.</Text>
            ) : activaciones.map(renderActivacion)}
          </View>
        )}
      </View>
    );
  };

  const renderResumen = (activadores) => {
    const resumen = resumirActivadores(activadores);
    return (
      <View style={styles.summaryRow}>
        {[
          ['Activadores', resumen.activadores],
          ['Hoy', resumen.hoy],
          ['Semana', resumen.semana],
          ['Mes', resumen.mes],
          ['Total', resumen.total],
        ].map(([label, value]) => (
          <View key={label} style={styles.summaryMetric}>
            <Text style={styles.summaryValue}>{value}</Text>
            <Text style={styles.summaryLabel}>{label}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderEquipo = (equipo) => {
    const key = `equipo:${equipo.id}`;
    const abierto = !!abiertos[key];
    const etiqueta = equipo.numero ? `Equipo ${equipo.numero} · ${equipo.nombre}` : equipo.nombre;
    return (
      <View key={equipo.id} style={styles.teamCard}>
        <TouchableOpacity style={styles.sectionButton} onPress={() => alternar(key)} activeOpacity={0.75}>
          <View style={styles.flexOne}>
            <Text style={styles.teamName}>{etiqueta}</Text>
            <Text style={styles.meta}>{equipo.activadores.length} activador(es)</Text>
          </View>
          <Text style={styles.chevron}>{abierto ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {renderResumen(equipo.activadores)}
        {abierto && (
          <View style={styles.teamContent}>
            {equipo.activadores.length === 0
              ? <Text style={styles.emptyInline}>Este equipo no tiene activadores vigentes.</Text>
              : equipo.activadores.map((activador) => renderActivador(equipo, activador))}
          </View>
        )}
      </View>
    );
  };

  const renderLider = (lider) => {
    const activadores = lider.equipos.flatMap((equipo) => equipo.activadores);
    if (!administrador) {
      return (
        <View key={lider.id}>
          <View style={styles.ownLeaderSummary}>
            <Text style={styles.leaderName}>{lider.nombre}</Text>
            {renderResumen(activadores)}
          </View>
          {lider.equipos.map(renderEquipo)}
        </View>
      );
    }
    const key = `lider:${lider.id}`;
    const abierto = !!abiertos[key];
    return (
      <View key={lider.id} style={styles.leaderCard}>
        <TouchableOpacity style={styles.sectionButton} onPress={() => alternar(key)} activeOpacity={0.75}>
          <View style={styles.flexOne}>
            <Text style={styles.leaderName}>{lider.nombre}</Text>
            <Text style={styles.meta}>{lider.equipos.length} equipo(s)</Text>
          </View>
          <Text style={styles.chevron}>{abierto ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {renderResumen(activadores)}
        {abierto && <View style={styles.leaderContent}>{lider.equipos.map(renderEquipo)}</View>}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.message}>Cargando Control Activadores…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.flexOne}>
          <Text style={styles.title}>Control Activadores</Text>
          <Text style={styles.subtitle}>
            {administrador ? 'Líderes, equipos y activadores' : 'Tus equipos y activadores'}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={() => cargar({ manual: true })} disabled={refreshing}>
          <Text style={styles.refreshText}>{refreshing ? 'Actualizando…' : 'Actualizar'}</Text>
        </TouchableOpacity>
      </View>
      {!!error && <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View>}
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => cargar({ manual: true })} tintColor={colors.primary} />}
      >
        {jerarquia.length === 0
          ? <View style={styles.emptyCard}><Text style={styles.message}>No hay equipos vigentes para mostrar.</Text></View>
          : jerarquia.map(renderLider)}
      </ScrollView>

      <Modal visible={!!foto} transparent animationType="fade" onRequestClose={() => setFoto(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: height * 0.85 }]}>
            <View style={styles.rowBetween}>
              <Text style={styles.modalTitle}>{foto?.titulo}</Text>
              <TouchableOpacity onPress={() => setFoto(null)}><Text style={styles.closeText}>Cerrar</Text></TouchableOpacity>
            </View>
            {fotoLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={styles.photoLoader} />
            ) : fotoError ? (
              <Text style={styles.inlineError}>{fotoError}</Text>
            ) : foto?.uri ? (
              <Image source={{ uri: foto.uri }} style={[styles.photo, { height: height * 0.62 }]} resizeMode="contain" />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  flexOne: { flex: 1 },
  message: { color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  title: { color: colors.text, fontSize: fontSizes.large, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: fontSizes.small, marginTop: 3 },
  refreshButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  refreshText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  errorCard: { borderColor: colors.danger, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md, backgroundColor: colors.surface },
  errorText: { color: colors.danger },
  list: { paddingBottom: 100 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  leaderCard: { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
  ownLeaderSummary: { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing.md, paddingTop: spacing.md, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
  leaderName: { color: colors.text, fontSize: fontSizes.medium, fontWeight: '800' },
  leaderContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  teamCard: { backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
  teamName: { color: colors.text, fontSize: fontSizes.medium, fontWeight: '700' },
  teamContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  sectionButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  chevron: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  activatorCard: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  activatorName: { flex: 1, color: colors.text, fontWeight: '800', fontSize: fontSizes.medium },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { color: colors.primary, fontWeight: '800', fontSize: fontSizes.large },
  metricLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  summaryRow: { flexDirection: 'row', paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
  summaryMetric: { flex: 1, alignItems: 'center' },
  summaryValue: { color: colors.primaryDark, fontWeight: '800', fontSize: fontSizes.small },
  summaryLabel: { color: colors.textMuted, fontSize: 9, marginTop: 2, textAlign: 'center' },
  actionText: { color: colors.primary, fontWeight: '700', fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
  activationsContainer: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: spacing.sm },
  activationCard: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  activationDate: { color: colors.text, fontWeight: '800' },
  activationType: { color: colors.primary, fontSize: 12, flexShrink: 1, textAlign: 'right' },
  activationClient: { color: colors.text, fontWeight: '600', marginTop: spacing.xs },
  evidenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  evidenceButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  evidenceText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  inlineError: { color: colors.danger, textAlign: 'center', padding: spacing.sm },
  emptyInline: { color: colors.textMuted, textAlign: 'center', padding: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.md },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  modalTitle: { flex: 1, color: colors.text, fontSize: fontSizes.medium, fontWeight: '800' },
  closeText: { color: colors.primary, fontWeight: '800' },
  photoLoader: { minHeight: 220 },
  photo: { width: '100%', marginTop: spacing.md, backgroundColor: colors.background, borderRadius: radius.md },
});
