const clavesFormulario = (item) => [...new Set([
  item?.id,
  item?._id_local,
].map((value) => String(value || '')).filter(Boolean))];

const claveFormulario = (item) => clavesFormulario(item)[0] || '';

const filtrarFormulariosNoDuplicados = (formularios = [], referencias = []) => {
  const clavesVistas = new Set(
    (Array.isArray(referencias) ? referencias : []).flatMap(clavesFormulario),
  );

  return (Array.isArray(formularios) ? formularios : []).filter((item) => {
    const claves = clavesFormulario(item);
    if (claves.some((clave) => clavesVistas.has(clave))) return false;
    claves.forEach((clave) => clavesVistas.add(clave));
    return true;
  });
};

const combinarFormulariosSinDuplicados = (anteriores = [], nuevos = []) => [
  ...(Array.isArray(anteriores) ? anteriores : []),
  ...filtrarFormulariosNoDuplicados(nuevos, anteriores),
];

const puedeConsultarHistorialRemoto = ({
  isConnected,
  isInternetReachable,
  bloqueado = false,
} = {}) => (
  isConnected === true
  && isInternetReachable !== false
  && bloqueado !== true
);

const crearControlConsultaUnica = () => {
  let consultaActual = null;
  return {
    ejecutar(operacion) {
      if (consultaActual) return { iniciada: false, promesa: consultaActual };
      const promesa = Promise.resolve().then(operacion);
      const seguida = promesa.finally(() => {
        if (consultaActual === seguida) consultaActual = null;
      });
      consultaActual = seguida;
      return { iniciada: true, promesa: seguida };
    },
    enCurso() {
      return consultaActual !== null;
    },
  };
};

const fechaFormulario = (item) => String(
  item?.fecha_activacion || item?._created_at || item?.created_at || item?.creado_en || '',
).slice(0, 10);

const esPendienteSync = (item) => (
  item?._origen === 'local'
  || item?.estado_sync === 'offline_pending'
  || item?._sync?.status === 'pending'
);

const combinarHistorialLocalRemoto = ({
  locales = [],
  remotos = [],
  ownerId,
  periodo = {},
  administrador = false,
} = {}) => {
  const localesCandidatos = (Array.isArray(locales) ? locales : [])
    .filter((item) => {
      if (!ownerId || item?.usuario_id !== ownerId) return false;
      const fecha = fechaFormulario(item);
      if (!fecha) return false;
      if (periodo.desde && fecha < periodo.desde) return false;
      if (periodo.hasta && fecha > periodo.hasta) return false;
      if (!esPendienteSync(item) && !administrador) return false;
      return true;
    })
    .map((item) => ({ ...item, _origen: 'local' }));
  const remotosValidos = Array.isArray(remotos) ? remotos : [];
  const localesPendientes = filtrarFormulariosNoDuplicados(localesCandidatos, remotosValidos);

  return [...localesPendientes, ...remotosValidos].sort(
    (a, b) => fechaFormulario(b).localeCompare(fechaFormulario(a)),
  );
};

const persistirReemplazoFoto = async ({
  destino,
  fieldName,
  patch,
  verificarArchivo,
  persistir,
  releer,
} = {}) => {
  const info = await verificarArchivo(destino);
  if (!info?.exists || (Number.isFinite(info.size) && info.size <= 0)) {
    throw new Error('La fotografía procesada no quedó disponible localmente.');
  }

  const persistido = await persistir(patch);
  if (persistido !== true) {
    throw new Error('No se pudo persistir la nueva referencia de fotografía.');
  }

  const confirmado = await releer();
  if (
    confirmado?.[fieldName] !== destino
    || confirmado?._sync?.localPhotos?.[fieldName] !== destino
  ) {
    throw new Error('La nueva referencia de fotografía no pudo confirmarse.');
  }
  return confirmado;
};

module.exports = {
  claveFormulario,
  clavesFormulario,
  combinarHistorialLocalRemoto,
  combinarFormulariosSinDuplicados,
  crearControlConsultaUnica,
  filtrarFormulariosNoDuplicados,
  persistirReemplazoFoto,
  puedeConsultarHistorialRemoto,
};
