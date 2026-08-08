import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
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

const TIPOS_ACTIVACION = [
  { key: 'comercio', label: 'Comercio' },
  { key: 'no_habilitado', label: 'No habilitado' },
  { key: 'reactivacion', label: 'Reactivación' },
  { key: 'config_cuenta', label: 'Configuración de cuenta' },
  { key: 'reimpresion_qr', label: 'Reimpresión QR' },
  { key: 'reactivacion_comercio', label: 'Reactivación Comercio' },
  { key: 'limbo', label: 'Limbo (Configuración de Cuenta)' },
  { key: 'transeunte', label: 'Transeúnte' },
  { key: 'reactivacion_transeunte', label: 'Reactivación Transeúnte' },
];

const claveDetalleFiltrada = (equipoId, activadorId, desde, hasta) => [
  equipoId,
  activadorId,
  desde || '',
  hasta || '',
].join(':');
const nombreVisible = (value, fallback) => normalizarNombreVisible(value || '') || fallback;
const fechaVisible = (item) => String(item?.fecha_activacion || item?.created_at || '').slice(0, 10) || 'Sin fecha';
const clienteVisible = (item) => [item?.nombres_cliente, item?.apellidos_cliente].filter(Boolean).join(' ').trim();
const fechaPicker = (value) => (value ? new Date(`${value}T12:00:00`) : new Date());
const fechaIso = (date) => date.toISOString().slice(0, 10);
const fechaLegible = (value) => {
  if (!value) return 'Todas';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};
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
  const [detalles, setDetalles] = useState({});
  const [detalleLoading, setDetalleLoading] = useState({});
  const [detalleErrores, setDetalleErrores] = useState({});
  const [vistaDetalle, setVistaDetalle] = useState(false);
  const [filtros, setFiltros] = useState({ desde: '', hasta: '', activador: '', tipo: '' });
  const [filtrosAplicados, setFiltrosAplicados] = useState({ desde: '', hasta: '' });
  const [filtrosError, setFiltrosError] = useState('');
  const [selectorFecha, setSelectorFecha] = useState(null);
  const [activadorSeleccionado, setActivadorSeleccionado] = useState(null);
  const [activacionSeleccionada, setActivacionSeleccionada] = useState(null);
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
        p_desde: filtrosAplicados.desde || null,
        p_hasta: filtrosAplicados.hasta || null,
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
  }, [filtrosAplicados.desde, filtrosAplicados.hasta, isConnected]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const jerarquia = useMemo(() => agruparJerarquia(rows), [rows]);
  const activadoresGlobales = useMemo(
    () => jerarquia.flatMap((lider) => lider.equipos.flatMap((equipo) => equipo.activadores)),
    [jerarquia],
  );
  const resumenGlobal = useMemo(() => resumirActivadores(activadoresGlobales), [activadoresGlobales]);
  const integrantes = useMemo(
    () => jerarquia.flatMap((lider) => lider.equipos.flatMap((equipo) => equipo.activadores.map((activador) => ({
      ...activador,
      liderId: lider.id,
      liderNombre: lider.nombre,
      equipoId: equipo.id,
      equipoNombre: equipo.nombre,
      equipoNumero: equipo.numero,
    })))),
    [jerarquia],
  );
  const integrantesFiltrados = useMemo(() => {
    if (!filtros.activador) return integrantes;
    return integrantes.filter((item) => item.id === filtros.activador);
  }, [filtros.activador, integrantes]);

  const cargarActivaciones = useCallback(async (equipoId, activadorId) => {
    const key = claveDetalleFiltrada(equipoId, activadorId, filtrosAplicados.desde, filtrosAplicados.hasta);
    if (Object.prototype.hasOwnProperty.call(detalles, key) || detalleLoading[key]) return;

    setDetalleLoading((actual) => ({ ...actual, [key]: true }));
    setDetalleErrores((actual) => ({ ...actual, [key]: '' }));
    try {
      const { data, error: queryError } = await supabase.rpc('control_activaciones_detalle', {
        p_activador_id: activadorId,
        p_equipo_id: equipoId,
        p_desde: filtrosAplicados.desde || null,
        p_hasta: filtrosAplicados.hasta || null,
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
  }, [detalleLoading, detalles, filtrosAplicados.desde, filtrosAplicados.hasta]);

  const seleccionarActivador = useCallback((activador) => {
    setActivadorSeleccionado(activador);
    cargarActivaciones(activador.equipoId, activador.id);
  }, [cargarActivaciones]);

  const seleccionarFiltroActivador = useCallback((activadorId) => {
    setFiltros((actual) => ({ ...actual, activador: activadorId }));
    setActivacionSeleccionada(null);
    if (!activadorId) {
      setActivadorSeleccionado(null);
      return;
    }
    const activador = integrantes.find((item) => item.id === activadorId);
    if (activador) seleccionarActivador(activador);
  }, [integrantes, seleccionarActivador]);

  const cambiarFecha = useCallback((campo, event, date) => {
    if (Platform.OS !== 'ios') setSelectorFecha(null);
    if (event?.type === 'dismissed' || !date) return;
    setFiltros((actual) => ({ ...actual, [campo]: fechaIso(date) }));
    setFiltrosError('');
  }, []);

  const aplicarFiltros = useCallback(() => {
    const desde = filtros.desde.trim();
    const hasta = filtros.hasta.trim();
    if (desde && hasta && desde > hasta) {
      setFiltrosError('La fecha Desde no puede ser mayor que Hasta.');
      return;
    }
    setFiltrosError('');
    setDetalles({});
    setDetalleErrores({});
    setActivacionSeleccionada(null);
    setFiltrosAplicados({ desde, hasta });
  }, [filtros.desde, filtros.hasta]);

  const renderControlFecha = (campo, label) => (
    <View style={styles.filterInput}>
      <Text style={styles.filterLabel}>{label}</Text>
      {Platform.OS === 'web' ? (
        <View style={styles.webDateWrapper}>
          <Text style={styles.dateButtonText}>{fechaLegible(filtros[campo])}</Text>
          <TextInput
            accessibilityLabel={label}
            value={filtros[campo]}
            onChangeText={(value) => {
              setFiltros((actual) => ({ ...actual, [campo]: value }));
              setFiltrosError('');
            }}
            style={styles.webDateInput}
            type="date"
          />
        </View>
      ) : (
        <TouchableOpacity style={styles.dateButton} onPress={() => setSelectorFecha(campo)}>
          <Text style={styles.dateButtonText}>{fechaLegible(filtros[campo])}</Text>
        </TouchableOpacity>
      )}
      {!!filtros[campo] && (
        <TouchableOpacity
          style={styles.clearDateButton}
          onPress={() => {
            setFiltros((actual) => ({ ...actual, [campo]: '' }));
            setFiltrosError('');
            if (selectorFecha === campo) setSelectorFecha(null);
          }}
        >
          <Text style={styles.clearDateText}>Limpiar</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  useEffect(() => {
    if (!activadorSeleccionado) return;
    cargarActivaciones(activadorSeleccionado.equipoId, activadorSeleccionado.id);
  }, [activadorSeleccionado, cargarActivaciones]);

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
    const cliente = clienteVisible(item);
    return (
      <TouchableOpacity key={item.id} style={styles.activationCard} onPress={() => setActivacionSeleccionada(item)} activeOpacity={0.8}>
        <View style={styles.rowBetween}>
          <Text style={styles.activationDate}>{fechaVisible(item)}</Text>
          <Text style={styles.activationType}>{item?.tipo_activacion || 'Activación'}</Text>
        </View>
        {!!cliente && <Text style={styles.activationClient}>{cliente}</Text>}
        {!!item?.plaza && <Text style={styles.meta}>Plaza: {item.plaza}</Text>}
      </TouchableOpacity>
    );
  };

  const renderResumenGlobal = () => (
    <View style={styles.globalGrid}>
      {[
        ['Activadores', resumenGlobal.activadores],
        ['Hoy', resumenGlobal.hoy],
        ['Semana', resumenGlobal.semana],
        ['Mes', resumenGlobal.mes],
        ['Total', resumenGlobal.total],
      ].map(([label, value]) => (
        <View key={label} style={styles.globalMetric}>
          <Text style={styles.globalValue}>{value}</Text>
          <Text style={styles.globalLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );

  const renderDetalleActivador = () => {
    if (!activadorSeleccionado) return null;
    const key = claveDetalleFiltrada(
      activadorSeleccionado.equipoId,
      activadorSeleccionado.id,
      filtrosAplicados.desde,
      filtrosAplicados.hasta,
    );
    const tipoFiltro = filtros.tipo;
    const activaciones = (detalles[key] || []).filter(
      (item) => !tipoFiltro || item?.tipo_activacion === tipoFiltro,
    );
    const resumenFiltrado = {
      hoy: activaciones.filter((item) => fechaVisible(item) === new Date().toISOString().slice(0, 10)).length,
      semana: activaciones.filter((item) => {
        const fecha = new Date(`${fechaVisible(item)}T00:00:00`);
        const hoy = new Date();
        const inicioSemana = new Date(hoy);
        inicioSemana.setDate(hoy.getDate() - hoy.getDay() + 1);
        inicioSemana.setHours(0, 0, 0, 0);
        return fecha >= inicioSemana && fecha <= hoy;
      }).length,
      mes: activaciones.filter((item) => fechaVisible(item).slice(0, 7) === new Date().toISOString().slice(0, 7)).length,
      total: activaciones.length,
    };
    return (
      <View style={styles.selectedCard}>
        <Text style={styles.selectedName}>{activadorSeleccionado.nombre}</Text>
        <Text style={styles.meta}>
          {activadorSeleccionado.equipoNumero ? `Equipo ${activadorSeleccionado.equipoNumero} · ` : ''}
          {activadorSeleccionado.equipoNombre}
        </Text>
        <View style={styles.metricsRow}>
          {[['Hoy', resumenFiltrado.hoy], ['Semana', resumenFiltrado.semana], ['Mes', resumenFiltrado.mes], ['Total', resumenFiltrado.total]].map(([label, value]) => (
            <View key={label} style={styles.metric}>
              <Text style={styles.metricValue}>{value}</Text>
              <Text style={styles.metricLabel}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.activationsContainer}>
          {detalleLoading[key] ? (
            <ActivityIndicator color={colors.primary} />
          ) : detalleErrores[key] ? (
            <Text style={styles.inlineError}>{detalleErrores[key]}</Text>
          ) : activaciones.length === 0 ? (
            <Text style={styles.emptyInline}>No hay activaciones atribuibles a este equipo.</Text>
          ) : activaciones.map(renderActivacion)}
        </View>
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
          <Text style={styles.title}>{vistaDetalle ? 'Ver Detalle' : 'Métricas Generales'}</Text>
          <Text style={styles.subtitle}>
            {administrador ? 'Todos los equipos autorizados' : 'Tus equipos autorizados'}
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
        {jerarquia.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.message}>No hay equipos vigentes para mostrar.</Text></View>
        ) : vistaDetalle ? (
          <>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                setVistaDetalle(false);
                setActivadorSeleccionado(null);
              }}
            >
              <Text style={styles.backButtonText}>Volver a Métricas Generales</Text>
            </TouchableOpacity>
            <View style={styles.filtersCard}>
              <Text style={styles.membersTitle}>Filtros</Text>
              <View style={styles.filtersRow}>
                {renderControlFecha('desde', 'Desde')}
                {renderControlFecha('hasta', 'Hasta')}
              </View>
              {Platform.OS !== 'web' && selectorFecha && (
                <DateTimePicker
                  value={fechaPicker(filtros[selectorFecha])}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, date) => cambiarFecha(selectorFecha, event, date)}
                />
              )}
              <Text style={styles.filterLabel}>Activador</Text>
              <View style={styles.pickerShell}>
                <Picker
                  selectedValue={filtros.activador}
                  onValueChange={seleccionarFiltroActivador}
                  style={styles.picker}
                >
                  <Picker.Item label="Todos" value="" />
                  {integrantes.map((item) => (
                    <Picker.Item key={`${item.equipoId}:${item.id}`} label={item.nombre} value={item.id} />
                  ))}
                </Picker>
              </View>
              <Text style={styles.filterLabel}>Tipo de activación</Text>
              <View style={styles.pickerShell}>
                <Picker
                  selectedValue={filtros.tipo}
                  onValueChange={(tipo) => setFiltros((actual) => ({ ...actual, tipo }))}
                  style={styles.picker}
                >
                  <Picker.Item label="Todos" value="" />
                  {TIPOS_ACTIVACION.map((item) => (
                    <Picker.Item key={item.key} label={item.label} value={item.key} />
                  ))}
                </Picker>
              </View>
              {!!filtrosError && <Text style={styles.inlineError}>{filtrosError}</Text>}
              <TouchableOpacity style={styles.applyButton} onPress={aplicarFiltros}>
                <Text style={styles.applyButtonText}>Aplicar filtros</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.membersCard}>
              <Text style={styles.membersTitle}>Integrantes</Text>
              {integrantesFiltrados.length === 0 ? (
                <Text style={styles.emptyInline}>No hay integrantes con ese criterio.</Text>
              ) : integrantesFiltrados.map((item) => {
                const selected = activadorSeleccionado?.id === item.id && activadorSeleccionado?.equipoId === item.equipoId;
                return (
                  <TouchableOpacity
                    key={`${item.equipoId}:${item.id}`}
                    style={[styles.memberRow, selected && styles.memberRowSelected]}
                    onPress={() => seleccionarActivador(item)}
                  >
                    <View style={styles.flexOne}>
                      <Text style={styles.memberName}>{item.nombre}</Text>
                      <Text style={styles.meta}>
                        {item.equipoNumero ? `Equipo ${item.equipoNumero} · ` : ''}{item.equipoNombre}
                        {administrador ? ` · ${item.liderNombre}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.memberTotal}>{item.total}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {renderDetalleActivador()}
          </>
        ) : (
          <View style={styles.globalCard}>
            {renderResumenGlobal()}
            <TouchableOpacity style={styles.detailButton} onPress={() => setVistaDetalle(true)}>
              <Text style={styles.detailButtonText}>VER DETALLE</Text>
            </TouchableOpacity>
          </View>
        )}
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

      <Modal visible={!!activacionSeleccionada} transparent animationType="slide" onRequestClose={() => setActivacionSeleccionada(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: height * 0.85 }]}>
            <View style={styles.rowBetween}>
              <Text style={styles.modalTitle}>Detalle de activación</Text>
              <TouchableOpacity onPress={() => setActivacionSeleccionada(null)}><Text style={styles.closeText}>Cerrar</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.detailLabel}>Cliente</Text>
              <Text style={styles.detailValue}>{clienteVisible(activacionSeleccionada) || 'Sin cliente'}</Text>
              <Text style={styles.detailLabel}>Tipo</Text>
              <Text style={styles.detailValue}>{activacionSeleccionada?.tipo_activacion || 'Sin tipo'}</Text>
              <Text style={styles.detailLabel}>Fecha</Text>
              <Text style={styles.detailValue}>{fechaVisible(activacionSeleccionada)}</Text>
              <Text style={styles.detailLabel}>Plaza</Text>
              <Text style={styles.detailValue}>{activacionSeleccionada?.plaza || 'Sin plaza'}</Text>
              <Text style={styles.detailLabel}>Equipo histórico</Text>
              <Text style={styles.detailValue}>{activacionSeleccionada?.equipo_id_registro || activadorSeleccionado?.equipoNombre || 'Sin equipo'}</Text>
              <Text style={styles.detailLabel}>Líder histórico</Text>
              <Text style={styles.detailValue}>{activacionSeleccionada?.lider_id_registro || activadorSeleccionado?.liderNombre || 'Sin líder'}</Text>
              <Text style={styles.detailLabel}>Evidencias</Text>
              {(activacionSeleccionada?.foto_url || activacionSeleccionada?.foto_cash_in) ? (
                <View style={styles.evidenceRow}>
                  {!!activacionSeleccionada.foto_url && (
                    <TouchableOpacity style={styles.evidenceButton} onPress={() => abrirFoto(activacionSeleccionada.foto_url, 'Evidencia de activación')}>
                      <Text style={styles.evidenceText}>Foto activación</Text>
                    </TouchableOpacity>
                  )}
                  {!!activacionSeleccionada.foto_cash_in && (
                    <TouchableOpacity style={styles.evidenceButton} onPress={() => abrirFoto(activacionSeleccionada.foto_cash_in, 'Evidencia Cash-In')}>
                      <Text style={styles.evidenceText}>Foto Cash-In</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : <Text style={styles.detailValue}>Sin evidencias disponibles.</Text>}
            </ScrollView>
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
  globalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  globalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  globalMetric: { flexGrow: 1, flexBasis: '30%', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  globalValue: { color: colors.primaryDark, fontWeight: '900', fontSize: fontSizes.xlarge },
  globalLabel: { color: colors.textMuted, fontSize: fontSizes.small, marginTop: 3, textAlign: 'center' },
  detailButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  detailButtonText: { color: '#fff', fontWeight: '900', fontSize: fontSizes.small },
  backButton: { alignSelf: 'flex-start', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  backButtonText: { color: colors.primary, fontWeight: '800' },
  membersCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  filtersCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  filtersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterInput: { flex: 1, minWidth: 140 },
  filterLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', marginBottom: spacing.xs },
  dateButton: { minHeight: 44, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder, justifyContent: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.md },
  dateButtonText: { color: colors.text, fontWeight: '700' },
  webDateWrapper: { minHeight: 44, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder, justifyContent: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.md, overflow: 'hidden' },
  webDateInput: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0, cursor: 'pointer' },
  clearDateButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs, marginBottom: spacing.sm },
  clearDateText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  pickerShell: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder, marginBottom: spacing.md, overflow: 'hidden' },
  picker: { color: colors.text },
  applyButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' },
  applyButtonText: { color: '#fff', fontWeight: '800' },
  membersTitle: { color: colors.text, fontSize: fontSizes.medium, fontWeight: '800', marginBottom: spacing.sm },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.surfaceAlt },
  memberRowSelected: { borderWidth: 1, borderColor: colors.primary },
  memberName: { color: colors.text, fontWeight: '800' },
  memberTotal: { color: colors.primaryDark, fontWeight: '900', minWidth: 36, textAlign: 'right' },
  selectedCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  selectedName: { color: colors.text, fontSize: fontSizes.medium, fontWeight: '900' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { color: colors.primary, fontWeight: '800', fontSize: fontSizes.large },
  metricLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
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
  detailScroll: { marginTop: spacing.md },
  detailLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', marginTop: spacing.sm },
  detailValue: { color: colors.text, fontSize: fontSizes.small, fontWeight: '600', marginTop: 3 },
  photoLoader: { minHeight: 220 },
  photo: { width: '100%', marginTop: spacing.md, backgroundColor: colors.background, borderRadius: radius.md },
});
