const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const esUuidValido = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

const clasificarIdActivacion = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return 'ausente';
  }
  return esUuidValido(value) ? 'valido' : 'invalido';
};

const asegurarUuidActivacionPersistido = async ({
  id,
  idLocal,
  generarUuid,
  persistir,
  leerPersistido,
}) => {
  const estado = clasificarIdActivacion(id);
  if (estado === 'valido') return { ok: true, recordId: id, source: 'existing' };
  if (estado === 'invalido') return { ok: false, reason: 'invalid_id' };
  if (idLocal === null || idLocal === undefined || idLocal === '') {
    return { ok: false, reason: 'missing_local_identity' };
  }

  const recordId = esUuidValido(idLocal) ? idLocal : generarUuid();
  if (!esUuidValido(recordId)) return { ok: false, reason: 'invalid_generated_id' };

  try {
    if (await persistir(recordId) !== true) {
      return { ok: false, reason: 'persistence_failed' };
    }
    const persisted = await leerPersistido();
    if (!persisted || persisted.id !== recordId) {
      return { ok: false, reason: 'persistence_not_confirmed' };
    }
  } catch (error) {
    return { ok: false, reason: 'persistence_failed', error };
  }

  return {
    ok: true,
    recordId,
    source: esUuidValido(idLocal) ? 'local_id' : 'generated',
  };
};

module.exports = {
  asegurarUuidActivacionPersistido,
  clasificarIdActivacion,
  esUuidValido,
};
