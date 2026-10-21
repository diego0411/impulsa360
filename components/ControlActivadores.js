import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { etiquetaPlaza } from '../lib/plazas';
import { fechaBolivia } from '../lib/fechaBolivia';
import {
  PERIODO_MES_ACTUAL,
  crearOpcionesPeriodoMensual,
  fechaEnPeriodoMensual,
  resolverPeriodoMensual,
} from '../lib/periodoMensual';
import { withTimeout } from '../lib/asyncTimeout';
import { enmascararMarcaVisible } from '../lib/brandMask';
import { resolverConsultaDetalleMetricas } from '../lib/controlActivadoresScope';
import { colors, fontSizes, radius, spacing } from '../styles/theme';
import SelectorRN from './SelectorRN';

const QUERY_TIMEOUT_MS = 12000;

const normalizarRol = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_|_$/g, '');
const rolesNormalizados = (value) => {
  if (Array.isArray(value)) return value.flatMap(rolesNormalizados);
  const rol = normalizarRol(value);
  if (!rol) return [];
  return rol.split('_').filter(Boolean);
};

const esRolAdministrador = (value) => {
  const roles = rolesNormalizados(value);
  return ['admin', 'administrador', 'administrator'].some(
    (item) => roles.includes(item),
  );
};
const esRolActivador = (value) => rolesNormalizados(value).includes('activador');
const esRolLider = (value) => ['lider', 'leader', 'supervisor'].some(
  (item) => rolesNormalizados(value).includes(item),
);

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
const esReactivacionTipo = (tipo) => /reactivacion/i.test(String(tipo || ''));
const esReimpresionTipo = (tipo) => String(tipo || '').toLowerCase() === 'reimpresion_qr';
const porcentaje = (cantidad, total) => (total > 0 ? `${Math.round((cantidad / total) * 100)}%` : '0%');
const resumenTiposVacio = { total: 0, reactivaciones: 0, reimpresiones: 0, tipos: [] };
const labelTipoActivacion = (tipo) => {
  const tipoTexto = String(tipo || '').trim();
  return TIPOS_ACTIVACION.find((item) => item.key === tipoTexto)?.label || tipoTexto || 'Sin tipo';
};
const calcularResumenTipos = (activaciones = []) => {
  const lista = Array.isArray(activaciones) ? activaciones : [];
  const conteo = new Map();
  lista.forEach((item) => {
    const tipo = String(item?.tipo_activacion || '').trim() || 'sin_tipo';
    conteo.set(tipo, (conteo.get(tipo) || 0) + 1);
  });
  const tipos = [...conteo.entries()]
    .map(([tipo, cantidad]) => ({ tipo, label: labelTipoActivacion(tipo), cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.label.localeCompare(b.label));

  return {
    total: lista.length,
    reactivaciones: lista.filter((item) => esReactivacionTipo(item?.tipo_activacion)).length,
    reimpresiones: lista.filter((item) => esReimpresionTipo(item?.tipo_activacion)).length,
    tipos,
  };
};
const resumirActivadores = (activadores) => (activadores || []).reduce((resumen, activador) => ({
  activadores: resumen.activadores + 1,
  hoy: resumen.hoy + Number(activador?.hoy || 0),
  semana: resumen.semana + Number(activador?.semana || 0),
  mes: resumen.mes + Number(activador?.total || 0),
  total: resumen.total + Number(activador?.total || 0),
}), { activadores: 0, hoy: 0, semana: 0, mes: 0, total: 0 });

const inicioSemanaBolivia = (hoy = fechaBolivia()) => {
  const base = new Date(`${hoy}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return '';
  base.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  return base.toISOString().slice(0, 10);
};

const resumirActivaciones = (activaciones = [], hoy = fechaBolivia(), periodo) => {
  const lista = Array.isArray(activaciones) ? activaciones : [];
  const inicioSemana = inicioSemanaBolivia(hoy);
  return {
    activadores: new Set(lista.map((item) => item?.usuario_id).filter(Boolean)).size,
    hoy: lista.filter((item) => fechaVisible(item) === hoy).length,
    semana: lista.filter((item) => {
      const fecha = fechaVisible(item);
      return !!fecha && fecha >= inicioSemana && fecha <= hoy;
    }).length,
    mes: lista.filter((item) => fechaEnPeriodoMensual(fechaVisible(item), periodo)).length,
    total: lista.length,
  };
};

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

export default function ControlActivadores({
  usuario,
  isConnected,
  rolesError = '',
  metricasVersion = 0,
  onActualizarRoles,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [detalles, setDetalles] = useState({});
  const [detalleLoading, setDetalleLoading] = useState({});
  const [detalleErrores, setDetalleErrores] = useState({});
  const [vistaDetalle, setVistaDetalle] = useState(false);
  const [filtros, setFiltros] = useState({ activador: '', tipo: '' });
  const [filtrosAplicados, setFiltrosAplicados] = useState({ tipo: '' });
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState(PERIODO_MES_ACTUAL);
  const [activadorSeleccionado, setActivadorSeleccionado] = useState(null);
  const [activacionSeleccionada, setActivacionSeleccionada] = useState(null);
  const [foto, setFoto] = useState(null);
  const [fotoLoading, setFotoLoading] = useState(false);
  const [fotoError, setFotoError] = useState('');
  const [resumenTiposGlobal, setResumenTiposGlobal] = useState(resumenTiposVacio);
  const [resumenTiposError, setResumenTiposError] = useState('');
  const [resumenGlobalFiltrado, setResumenGlobalFiltrado] = useState(null);
  const [modoMetricas, setModoMetricas] = useState('equipo');
  const [recargaPendiente, setRecargaPendiente] = useState(0);
  const [rolesRefreshing, setRolesRefreshing] = useState(false);
  const cargaEnCursoRef = useRef(false);
  const recargaPendienteRef = useRef(false);
  const actualizacionManualRef = useRef(null);
  const consultaGeneracionRef = useRef(0);
  const montadoRef = useRef(true);
  const consultaClaveRef = useRef('');
  const { height } = useWindowDimensions();
  const rolesUsuario = [usuario?.rol, usuario?.role, usuario?.roles];
  const administrador = esRolAdministrador(rolesUsuario);
  const activador = esRolActivador(rolesUsuario);
  const lider = esRolLider(rolesUsuario);
  const activadorSolo = !administrador && !lider && activador;
  const multirrolActivadorLider = !administrador && activador && lider;
  const vistaPersonal = activadorSolo || (multirrolActivadorLider && modoMetricas === 'personal');
  const usuarioId = usuario?.id;
  const rolesClave = rolesUsuario.flatMap(rolesNormalizados).sort().join(',');
  const hoyBolivia = fechaBolivia();
  const filtrosConsulta = useMemo(
    () => resolverPeriodoMensual(periodoSeleccionado, hoyBolivia),
    [hoyBolivia, periodoSeleccionado],
  );
  const opcionesPeriodo = useMemo(
    () => crearOpcionesPeriodoMensual(hoyBolivia),
    [hoyBolivia],
  );
  const tipoConsulta = filtrosAplicados.tipo;

  const invalidarConsultas = useCallback(() => {
    consultaGeneracionRef.current += 1;
    return consultaGeneracionRef.current;
  }, []);
  const consultaVigente = useCallback((generacion) => (
    montadoRef.current && consultaGeneracionRef.current === generacion
  ), []);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      invalidarConsultas();
      recargaPendienteRef.current = false;
      actualizacionManualRef.current = null;
    };
  }, [invalidarConsultas]);

  const claveConsulta = [
    usuarioId,
    usuario?.estado || '',
    rolesClave,
    vistaPersonal ? 'personal' : 'equipo',
    filtrosConsulta.desde,
    filtrosConsulta.hasta,
    tipoConsulta,
    metricasVersion,
    isConnected ? 'online' : 'offline',
  ].join('|');

  useLayoutEffect(() => {
    if (consultaClaveRef.current === claveConsulta) return;
    consultaClaveRef.current = claveConsulta;
    invalidarConsultas();
    setLoading(true);
    setDetalles({});
    setDetalleLoading({});
    setDetalleErrores({});
  }, [claveConsulta, invalidarConsultas]);

  const cargarResumenTiposGlobal = useCallback(async (rowsData = [], generacion) => {
    const vigente = () => consultaVigente(generacion);
    const pares = new Map();
    (Array.isArray(rowsData) ? rowsData : []).forEach((row) => {
      if (!row?.equipo_id || !row?.activador_id) return;
      pares.set(`${row.equipo_id}:${row.activador_id}`, {
        equipoId: row.equipo_id,
        activadorId: row.activador_id,
      });
    });

    if (pares.size === 0) {
      if (!vigente()) return { status: 'stale', rows: rowsData };
      setResumenTiposGlobal(resumenTiposVacio);
      setResumenTiposError('');
      setResumenGlobalFiltrado(tipoConsulta ? resumenTiposVacio : null);
      return { status: 'ok', rows: rowsData };
    }

    try {
      const paresDetalle = [...pares.values()];
      const resultados = await Promise.all(paresDetalle.map(({ equipoId, activadorId }) =>
        withTimeout(
          supabase.rpc('control_activaciones_detalle', {
            p_activador_id: activadorId,
            p_equipo_id: equipoId,
            p_desde: filtrosConsulta.desde || null,
            p_hasta: filtrosConsulta.hasta || null,
          }),
          QUERY_TIMEOUT_MS,
          'La señal está muy débil para cargar métricas.'
        )
      ));
      if (!vigente()) return { status: 'stale', rows: rowsData };
      const resultadoInvalido = resultados.find(({ error: queryError, data }) => queryError || !Array.isArray(data));
      if (resultadoInvalido) {
        throw resultadoInvalido.error || new Error('La respuesta de detalle no contiene activaciones válidas.');
      }
      const activacionesPorIntegrante = resultados.map(({ data }, index) => ({
        ...paresDetalle[index],
        activaciones: tipoConsulta
          ? data.filter((item) => item?.tipo_activacion === tipoConsulta)
          : data,
      }));
      const activaciones = activacionesPorIntegrante.flatMap(({ activaciones: lista }) => lista);
      const activacionesFiltradas = tipoConsulta
        ? activaciones.filter((item) => item?.tipo_activacion === tipoConsulta)
        : activaciones;
      const metricasPorIntegrante = new Map(
        activacionesPorIntegrante.map(({ equipoId, activadorId, activaciones: lista }) => [
          `${equipoId}:${activadorId}`,
          resumirActivaciones(lista, hoyBolivia, filtrosConsulta),
        ])
      );
      const rowsFiltradas = tipoConsulta
        ? rowsData.map((row) => {
          const resumen = metricasPorIntegrante.get(`${row?.equipo_id}:${row?.activador_id}`);
          return resumen ? { ...row, hoy: resumen.hoy, semana: resumen.semana, mes: resumen.mes, total: resumen.total } : row;
        })
        : rowsData;
      setResumenTiposGlobal(calcularResumenTipos(activacionesFiltradas));
      setResumenTiposError('');
      setResumenGlobalFiltrado(tipoConsulta ? resumirActivaciones(activacionesFiltradas, hoyBolivia, filtrosConsulta) : null);
      return { status: 'ok', rows: rowsFiltradas };
    } catch (e) {
      if (!vigente()) return { status: 'stale', rows: rowsData };
      setResumenTiposGlobal(resumenTiposVacio);
      setResumenGlobalFiltrado(null);
      setResumenTiposError(e?.message || 'No se pudo cargar el resumen por tipo.');
      return { status: 'error', rows: rowsData };
    }
  }, [consultaVigente, filtrosConsulta, hoyBolivia, tipoConsulta]);

  const cargar = useCallback(async ({ manual = false } = {}) => {
    if (cargaEnCursoRef.current) {
      recargaPendienteRef.current = true;
      return;
    }
    cargaEnCursoRef.current = true;
    const generacion = consultaGeneracionRef.current;
    const vigente = () => consultaVigente(generacion);
    if (!isConnected) {
      if (vigente()) {
        setError('Conéctate a internet para actualizar Control Activadores.');
        setLoading(false);
        setRefreshing(false);
      }
      cargaEnCursoRef.current = false;
      return;
    }

    if (vigente()) {
      if (manual) setRefreshing(true);
      else setLoading(true);
      setError('');
      if (manual) {
        setDetalles({});
        setDetalleLoading({});
        setDetalleErrores({});
      }
    }

    try {
      if (vistaPersonal) {
        let query = supabase
          .from('activaciones')
          .select('*')
          .eq('usuario_id', usuarioId)
          .order('fecha_activacion', { ascending: false });

        if (filtrosConsulta.desde) query = query.gte('fecha_activacion', filtrosConsulta.desde);
        if (filtrosConsulta.hasta) query = query.lte('fecha_activacion', filtrosConsulta.hasta);

        const { data, error: queryError } = await withTimeout(
          query,
          QUERY_TIMEOUT_MS,
          'La señal está muy débil para cargar métricas.'
        );
        if (queryError) throw queryError;
        if (!vigente()) return;

        const activacionesBase = Array.isArray(data) ? data : [];
        const activaciones = tipoConsulta
          ? activacionesBase.filter((item) => item?.tipo_activacion === tipoConsulta)
          : activacionesBase;
        const activadorNombre = nombreVisible(usuario?.nombre || usuario?.email, 'Mis métricas');
        const resumenPropio = resumirActivaciones(activaciones, hoyBolivia, filtrosConsulta);
        const rowPropia = {
          lider_id: usuarioId,
          lider_nombre: activadorNombre,
          equipo_id: 'propio',
          equipo_numero: null,
          equipo_nombre: 'Mis activaciones',
          activador_id: usuarioId,
          activador_nombre: activadorNombre,
          ...resumenPropio,
        };
        const detailKey = claveDetalleFiltrada('propio', usuarioId, filtrosConsulta.desde, filtrosConsulta.hasta);
        if (!vigente()) return;
        setRows([rowPropia]);
        setDetalles({ [detailKey]: activaciones });
        setResumenTiposGlobal(calcularResumenTipos(activaciones));
        setResumenTiposError('');
        setResumenGlobalFiltrado(null);
        if (manual) setDetalleErrores({});
        return;
      }

      const { data, error: queryError } = await withTimeout(
        supabase.rpc('control_activadores_jerarquia', {
          p_desde: filtrosConsulta.desde || null,
          p_hasta: filtrosConsulta.hasta || null,
        }),
        QUERY_TIMEOUT_MS,
        'La señal está muy débil para cargar métricas.'
      );
      if (queryError) throw queryError;
      if (!vigente()) return;
      const rowsData = Array.isArray(data) ? data : [];
      const resumen = await cargarResumenTiposGlobal(rowsData, generacion);
      if (!vigente() || resumen.status === 'stale') return;
      setRows(resumen.rows);
    } catch (e) {
      if (vigente()) {
        setError(e?.message || 'No se pudo cargar la jerarquía de activadores.');
        if (!manual) setRows([]);
      }
    } finally {
      cargaEnCursoRef.current = false;
      if (vigente()) {
        setLoading(false);
        setRefreshing(false);
      }
      if (recargaPendienteRef.current) {
        recargaPendienteRef.current = false;
        if (montadoRef.current) setRecargaPendiente((actual) => actual + 1);
      }
    }
  }, [cargarResumenTiposGlobal, consultaVigente, filtrosConsulta, hoyBolivia, isConnected, tipoConsulta, usuario?.email, usuario?.nombre, usuarioId, vistaPersonal]);

  useEffect(() => {
    cargar();
  }, [cargar, metricasVersion, recargaPendiente]);

  const actualizarControl = useCallback(() => {
    if (actualizacionManualRef.current) return actualizacionManualRef.current;
    if (typeof onActualizarRoles !== 'function') return cargar({ manual: true });

    invalidarConsultas();
    setRolesRefreshing(true);
    const actualizacion = Promise.resolve().then(onActualizarRoles).finally(() => {
      if (actualizacionManualRef.current === actualizacion) actualizacionManualRef.current = null;
      if (montadoRef.current) setRolesRefreshing(false);
    });
    actualizacionManualRef.current = actualizacion;
    return actualizacion;
  }, [cargar, invalidarConsultas, onActualizarRoles]);

  const jerarquia = useMemo(() => agruparJerarquia(rows), [rows]);
  const activadoresGlobales = useMemo(
    () => jerarquia.flatMap((lider) => lider.equipos.flatMap((equipo) => equipo.activadores)),
    [jerarquia],
  );
  const resumenGlobalBase = useMemo(() => resumirActivadores(activadoresGlobales), [activadoresGlobales]);
  const resumenGlobal = tipoConsulta ? resumenGlobalFiltrado : resumenGlobalBase;
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
    if (vistaPersonal) return integrantes.filter((item) => item.id === usuarioId);
    if (!filtros.activador) return integrantes;
    return integrantes.filter((item) => item.id === filtros.activador);
  }, [filtros.activador, integrantes, usuarioId, vistaPersonal]);

  const cargarActivaciones = useCallback(async (equipoId, activadorId) => {
    const key = claveDetalleFiltrada(equipoId, activadorId, filtrosConsulta.desde, filtrosConsulta.hasta);
    if (Object.prototype.hasOwnProperty.call(detalles, key) || detalleLoading[key]) return;
    const generacion = consultaGeneracionRef.current;
    const vigente = () => consultaVigente(generacion);

    if (!vigente()) return;
    setDetalleLoading((actual) => ({ ...actual, [key]: true }));
    setDetalleErrores((actual) => ({ ...actual, [key]: '' }));
    try {
      const consulta = resolverConsultaDetalleMetricas({ vistaPersonal, usuarioId, equipoId, activadorId });
      let solicitud;
      if (consulta.tipo === 'personal') {
        solicitud = supabase
          .from('activaciones')
          .select('*')
          .eq('usuario_id', consulta.usuarioId)
          .order('fecha_activacion', { ascending: false });
        if (filtrosConsulta.desde) solicitud = solicitud.gte('fecha_activacion', filtrosConsulta.desde);
        if (filtrosConsulta.hasta) solicitud = solicitud.lte('fecha_activacion', filtrosConsulta.hasta);
      } else {
        solicitud = supabase.rpc('control_activaciones_detalle', {
          p_activador_id: consulta.activadorId,
          p_equipo_id: consulta.equipoId,
          p_desde: filtrosConsulta.desde || null,
          p_hasta: filtrosConsulta.hasta || null,
        });
      }
      const { data, error: queryError } = await withTimeout(
        solicitud,
        QUERY_TIMEOUT_MS,
        'La señal está muy débil para cargar el detalle.'
      );
      if (queryError) throw queryError;
      if (!vigente()) return;
      setDetalles((actual) => ({ ...actual, [key]: Array.isArray(data) ? data : [] }));
    } catch (e) {
      if (!vigente()) return;
      setDetalleErrores((actual) => ({
        ...actual,
        [key]: e?.message || 'No se pudieron cargar las activaciones.',
      }));
    } finally {
      if (vigente()) setDetalleLoading((actual) => ({ ...actual, [key]: false }));
    }
  }, [consultaVigente, detalleLoading, detalles, filtrosConsulta.desde, filtrosConsulta.hasta, usuarioId, vistaPersonal]);

  const seleccionarActivador = useCallback((activador) => {
    if (vistaPersonal && activador?.id !== usuarioId) return;
    setActivadorSeleccionado(activador);
    cargarActivaciones(activador.equipoId, activador.id);
  }, [cargarActivaciones, usuarioId, vistaPersonal]);

  const seleccionarFiltroActivador = useCallback((activadorId) => {
    if (vistaPersonal) return;
    setFiltros((actual) => ({ ...actual, activador: activadorId }));
    setActivacionSeleccionada(null);
    if (!activadorId) {
      setActivadorSeleccionado(null);
      return;
    }
    const activador = integrantes.find((item) => item.id === activadorId);
    if (activador) seleccionarActivador(activador);
  }, [integrantes, seleccionarActivador, vistaPersonal]);

  const aplicarFiltros = useCallback(() => {
    invalidarConsultas();
    setLoading(true);
    setDetalles({});
    setDetalleLoading({});
    setDetalleErrores({});
    setActivacionSeleccionada(null);
    setFiltrosAplicados({ tipo: filtros.tipo });
  }, [filtros.tipo, invalidarConsultas]);

  const seleccionarPeriodo = useCallback((periodo) => {
    if (periodo === periodoSeleccionado) return;
    invalidarConsultas();
    setLoading(true);
    setPeriodoSeleccionado(periodo);
    setVistaDetalle(false);
    setActivadorSeleccionado(null);
    setActivacionSeleccionada(null);
    setDetalles({});
    setDetalleLoading({});
    setDetalleErrores({});
  }, [invalidarConsultas, periodoSeleccionado]);

  const seleccionarModoMetricas = useCallback((modo) => {
    if (modo === modoMetricas) return;
    invalidarConsultas();
    setLoading(true);
    setModoMetricas(modo);
    setVistaDetalle(false);
    setActivadorSeleccionado(null);
    setActivacionSeleccionada(null);
    setDetalles({});
    setDetalleLoading({});
    setDetalleErrores({});
  }, [invalidarConsultas, modoMetricas]);

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
    const cliente = enmascararMarcaVisible(clienteVisible(item), usuario);
    const plazaVisible = enmascararMarcaVisible(etiquetaPlaza(item?.plaza), usuario);
    return (
      <TouchableOpacity key={item.id} style={styles.activationCard} onPress={() => setActivacionSeleccionada(item)} activeOpacity={0.8}>
        <View style={styles.rowBetween}>
          <Text style={styles.activationDate}>{fechaVisible(item)}</Text>
          <Text style={styles.activationType}>{enmascararMarcaVisible(item?.tipo_activacion || 'Activación', usuario)}</Text>
        </View>
        {!!cliente && <Text style={styles.activationClient}>{cliente}</Text>}
        {!!plazaVisible && <Text style={styles.meta}>Plaza: {plazaVisible}</Text>}
      </TouchableOpacity>
    );
  };

  const renderResumenGlobal = () => (
    <>
      <View style={styles.globalGrid}>
        {[
          ['Activadores', resumenGlobal?.activadores ?? 'N/D'],
          ['Hoy', resumenGlobal?.hoy ?? 'N/D'],
          ['Semana', resumenGlobal?.semana ?? 'N/D'],
          ['Mes', resumenGlobal?.mes ?? 'N/D'],
          ['Total', resumenGlobal?.total ?? 'N/D'],
          ['Reactivación', resumenTiposError ? 'N/D' : `${resumenTiposGlobal.reactivaciones} · ${porcentaje(resumenTiposGlobal.reactivaciones, resumenTiposGlobal.total)}`],
          ['Reimpresión', resumenTiposError ? 'N/D' : `${resumenTiposGlobal.reimpresiones} · ${porcentaje(resumenTiposGlobal.reimpresiones, resumenTiposGlobal.total)}`],
        ].map(([label, value]) => (
          <View key={label} style={styles.globalMetric}>
            <Text style={[styles.globalValue, typeof value === 'string' && styles.globalValueCompact]}>{value}</Text>
            <Text style={styles.globalLabel}>{label}</Text>
          </View>
        ))}
      </View>
      {!!resumenTiposError && <Text style={styles.inlineError}>{resumenTiposError}</Text>}
      {!resumenTiposError && resumenGlobal?.total === 0 && (
        <Text style={styles.emptyInline}>No hay activaciones en {filtrosConsulta.etiqueta}.</Text>
      )}
      {vistaPersonal && resumenTiposGlobal.tipos.length > 0 && (
        <View style={styles.typeSummary}>
          <Text style={styles.membersTitle}>Tipos de activación</Text>
          {resumenTiposGlobal.tipos.map((item) => (
            <View key={item.tipo} style={styles.typeSummaryRow}>
              <Text style={styles.typeSummaryLabel}>{enmascararMarcaVisible(item.label, usuario)}</Text>
              <Text style={styles.typeSummaryValue}>{item.cantidad}</Text>
            </View>
          ))}
        </View>
      )}
    </>
  );

  const renderDetalleActivador = () => {
    if (!activadorSeleccionado) return null;
    const key = claveDetalleFiltrada(
      activadorSeleccionado.equipoId,
      activadorSeleccionado.id,
      filtrosConsulta.desde,
      filtrosConsulta.hasta,
    );
    const tipoFiltro = tipoConsulta;
    const activaciones = (detalles[key] || []).filter(
      (item) => !tipoFiltro || item?.tipo_activacion === tipoFiltro,
    );
    const resumenFiltrado = resumirActivaciones(activaciones, hoyBolivia, filtrosConsulta);
    return (
      <View style={styles.selectedCard}>
        <Text style={styles.selectedName}>{enmascararMarcaVisible(activadorSeleccionado.nombre, usuario)}</Text>
        <Text style={styles.meta}>
          {enmascararMarcaVisible(`${activadorSeleccionado.equipoNumero ? `Equipo ${activadorSeleccionado.equipoNumero} · ` : ''}${activadorSeleccionado.equipoNombre}`, usuario)}
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
                  <Text style={styles.inlineError}>{enmascararMarcaVisible(detalleErrores[key], usuario)}</Text>
          ) : activaciones.length === 0 ? (
            <Text style={styles.emptyInline}>No hay activaciones en {filtrosConsulta.etiqueta}.</Text>
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
            {vistaPersonal ? 'Solo tus activaciones' : administrador ? 'Todos los equipos autorizados' : 'Tus equipos autorizados'} · {filtrosConsulta.etiqueta}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={actualizarControl} disabled={refreshing || rolesRefreshing}>
          <Text style={styles.refreshText}>{refreshing || rolesRefreshing ? 'Actualizando…' : 'Actualizar'}</Text>
        </TouchableOpacity>
      </View>
      {!!error && <View style={styles.errorCard}><Text style={styles.errorText}>{enmascararMarcaVisible(error, usuario)}</Text></View>}
      {!!rolesError && <View style={styles.errorCard}><Text style={styles.errorText}>{rolesError}</Text></View>}
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing || rolesRefreshing} onRefresh={actualizarControl} tintColor={colors.primary} />}
      >
        {multirrolActivadorLider && (
          <View style={styles.modeControl}>
            <TouchableOpacity
              style={[styles.modeButton, modoMetricas === 'personal' && styles.modeButtonActive]}
              onPress={() => seleccionarModoMetricas('personal')}
              accessibilityRole="button"
              accessibilityState={{ selected: modoMetricas === 'personal' }}
            >
              <Text style={[styles.modeButtonText, modoMetricas === 'personal' && styles.modeButtonTextActive]}>Personales</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeButton, modoMetricas === 'equipo' && styles.modeButtonActive]}
              onPress={() => seleccionarModoMetricas('equipo')}
              accessibilityRole="button"
              accessibilityState={{ selected: modoMetricas === 'equipo' }}
            >
              <Text style={[styles.modeButtonText, modoMetricas === 'equipo' && styles.modeButtonTextActive]}>Equipo</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.periodCard}>
          <Text style={styles.filterLabel}>Período de métricas</Text>
          <View style={styles.pickerShell}>
            <SelectorRN
              selectedValue={periodoSeleccionado}
              onValueChange={seleccionarPeriodo}
              style={styles.picker}
              accessibilityLabel={`Período de métricas: ${filtrosConsulta.etiqueta}`}
              options={opcionesPeriodo}
            />
          </View>
          <Text style={styles.periodLabel}>{filtrosConsulta.etiqueta}</Text>
        </View>
        {jerarquia.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.message}>No hay equipos o activaciones disponibles en {filtrosConsulta.etiqueta}.</Text></View>
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
              {!vistaPersonal && (
                <>
                  <Text style={styles.filterLabel}>Activador</Text>
                  <View style={styles.pickerShell}>
                    <SelectorRN
                      selectedValue={filtros.activador}
                      onValueChange={seleccionarFiltroActivador}
                      style={styles.picker}
                      options={[
                        { label: 'Todos', value: '' },
                        ...integrantes.map((item) => ({
                          label: enmascararMarcaVisible(item.nombre, usuario),
                          value: item.id,
                        })),
                      ]}
                    />
                  </View>
                </>
              )}
              <Text style={styles.filterLabel}>Tipo de activación</Text>
              <View style={styles.pickerShell}>
                <SelectorRN
                  selectedValue={filtros.tipo}
                  onValueChange={(tipo) => setFiltros((actual) => ({ ...actual, tipo }))}
                  style={styles.picker}
                  options={[
                    { label: 'Todos', value: '' },
                    ...TIPOS_ACTIVACION.map((item) => ({ label: item.label, value: item.key })),
                  ]}
                />
              </View>
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
                      <Text style={styles.memberName}>{enmascararMarcaVisible(item.nombre, usuario)}</Text>
                      <Text style={styles.meta}>
                        {enmascararMarcaVisible(`${item.equipoNumero ? `Equipo ${item.equipoNumero} · ` : ''}${item.equipoNombre}${administrador ? ` · ${item.liderNombre}` : ''}`, usuario)}
                      </Text>
                    </View>
                    <Text style={styles.memberTotal}>{tipoConsulta && resumenTiposError ? 'N/D' : item.total}</Text>
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
              <Text style={styles.inlineError}>{enmascararMarcaVisible(fotoError, usuario)}</Text>
            ) : foto?.uri ? (
              <Image source={{ uri: foto.uri }} style={[styles.photo, { height: height * 0.62 }]} resizeMode="contain" resizeMethod="resize" />
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
              <Text style={styles.detailValue}>{enmascararMarcaVisible(clienteVisible(activacionSeleccionada) || 'Sin cliente', usuario)}</Text>
              <Text style={styles.detailLabel}>Tipo</Text>
              <Text style={styles.detailValue}>{enmascararMarcaVisible(activacionSeleccionada?.tipo_activacion || 'Sin tipo', usuario)}</Text>
              <Text style={styles.detailLabel}>Fecha</Text>
              <Text style={styles.detailValue}>{fechaVisible(activacionSeleccionada)}</Text>
              <Text style={styles.detailLabel}>Plaza</Text>
              <Text style={styles.detailValue}>{enmascararMarcaVisible(etiquetaPlaza(activacionSeleccionada?.plaza, 'Sin plaza'), usuario)}</Text>
              <Text style={styles.detailLabel}>Equipo histórico</Text>
              <Text style={styles.detailValue}>{enmascararMarcaVisible(activacionSeleccionada?.equipo_id_registro || activadorSeleccionado?.equipoNombre || 'Sin equipo', usuario)}</Text>
              <Text style={styles.detailLabel}>Líder histórico</Text>
              <Text style={styles.detailValue}>{enmascararMarcaVisible(activacionSeleccionada?.lider_id_registro || activadorSeleccionado?.liderNombre || 'Sin líder', usuario)}</Text>
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
  modeControl: { flexDirection: 'row', alignSelf: 'flex-start', marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radius.md, overflow: 'hidden' },
  modeButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  modeButtonActive: { backgroundColor: colors.primary },
  modeButtonText: { color: colors.text, fontWeight: '700', fontSize: fontSizes.small },
  modeButtonTextActive: { color: '#fff' },
  periodCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  periodLabel: { color: colors.text, fontSize: fontSizes.small, fontWeight: '800', textAlign: 'center' },
  errorCard: { borderColor: colors.danger, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md, backgroundColor: colors.surface },
  errorText: { color: colors.danger },
  list: { paddingBottom: 100 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  globalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  globalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  globalMetric: { flexGrow: 1, flexBasis: '30%', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  globalValue: { color: colors.primaryDark, fontWeight: '900', fontSize: fontSizes.xlarge },
  globalValueCompact: { fontSize: fontSizes.large },
  globalLabel: { color: colors.textMuted, fontSize: fontSizes.small, marginTop: 3, textAlign: 'center' },
  typeSummary: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: spacing.md },
  typeSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  typeSummaryLabel: { color: colors.text, fontWeight: '700', flex: 1, paddingRight: spacing.sm },
  typeSummaryValue: { color: colors.primaryDark, fontWeight: '900' },
  detailButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  detailButtonText: { color: '#fff', fontWeight: '900', fontSize: fontSizes.small },
  backButton: { alignSelf: 'flex-start', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  backButtonText: { color: colors.primary, fontWeight: '800' },
  membersCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  filtersCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  filterLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', marginBottom: spacing.xs },
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
