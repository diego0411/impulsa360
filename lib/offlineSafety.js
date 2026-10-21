const resolverLecturaPendientes = (lectura, ownerId) => {
  if (lectura?.status !== 'ok' || !Array.isArray(lectura?.value)) {
    return {
      ok: false,
      status: lectura?.status || 'temporarily_unreadable',
      allRows: null,
      rows: null,
      count: null,
    };
  }

  const rows = ownerId
    ? lectura.value.filter((item) => item?.usuario_id === ownerId)
    : [];
  return { ok: true, status: 'ok', allRows: lectura.value, rows, count: rows.length };
};

const asegurarSesionParaSync = async ({
  sesionValida,
  manual,
  revalidar,
  ownerId,
  obtenerOwnerId,
  logoutEnCurso,
} = {}) => {
  const sigueMismoOwner = () => (
    logoutEnCurso?.() !== true
    && obtenerOwnerId?.() === ownerId
  );
  if (sesionValida === true) return sigueMismoOwner();
  if (!manual || typeof revalidar !== 'function') return false;

  const revalidada = await revalidar();
  return revalidada === true && sigueMismoOwner();
};

const ejecutarOperacionSerializada = (operationRef, iniciar) => {
  if (operationRef?.current) return operationRef.current;
  if (!operationRef || typeof iniciar !== 'function') return Promise.resolve(false);
  const seguida = Promise.resolve()
    .then(iniciar)
    .finally(() => {
      if (operationRef.current === seguida) operationRef.current = null;
    });
  operationRef.current = seguida;
  return seguida;
};

const drenarEscriturasCoalescidas = async ({ inicial, tomarSiguiente, persistir } = {}) => {
  let actual = inicial;
  let resultado = true;
  while (actual) {
    resultado = await persistir(actual);
    if (resultado !== true) return false;
    actual = typeof tomarSiguiente === 'function' ? tomarSiguiente() : null;
  }
  return resultado;
};

module.exports = {
  asegurarSesionParaSync,
  drenarEscriturasCoalescidas,
  ejecutarOperacionSerializada,
  resolverLecturaPendientes,
};
