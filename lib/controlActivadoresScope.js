const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuidRequerido = (value, campo) => {
  if (!UUID_PATTERN.test(String(value || ''))) {
    throw new Error(`${campo} no contiene un UUID válido.`);
  }
  return value;
};

const resolverConsultaDetalleMetricas = ({ vistaPersonal, usuarioId, equipoId, activadorId }) => {
  if (vistaPersonal) {
    return { tipo: 'personal', usuarioId: uuidRequerido(usuarioId, 'usuarioId') };
  }

  return {
    tipo: 'equipo',
    equipoId: uuidRequerido(equipoId, 'equipoId'),
    activadorId: uuidRequerido(activadorId, 'activadorId'),
  };
};

module.exports = { resolverConsultaDetalleMetricas };
