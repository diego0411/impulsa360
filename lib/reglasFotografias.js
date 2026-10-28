// Matriz definitiva de fotografías por (tipo_grupo, tipo_activacion).
// Única fuente de verdad para el formulario y la sincronización.
// Desacoplada de requiereValidacionReactivacion (elegibilidad 90 días).
//
// evidencia: 'obligatoria' | 'opcional' | 'no'
// cashIn: true = Cash-In obligatorio, false = no requerido.
const MATRIZ_FOTOGRAFIAS = {
  comercio: {
    comercio: { evidencia: 'obligatoria', cashIn: true },
    reactivacion_comercio: { evidencia: 'obligatoria', cashIn: true },
    limbo: { evidencia: 'obligatoria', cashIn: true },
    no_habilitado: { evidencia: 'obligatoria', cashIn: false },
    reimpresion_qr: { evidencia: 'obligatoria', cashIn: true },
  },
  tienda_barrio: {
    comercio: { evidencia: 'obligatoria', cashIn: true },
    no_habilitado: { evidencia: 'obligatoria', cashIn: false },
    reactivacion: { evidencia: 'obligatoria', cashIn: true },
    config_cuenta: { evidencia: 'obligatoria', cashIn: true },
    reimpresion_qr: { evidencia: 'obligatoria', cashIn: true },
  },
  transeunte: {
    transeunte: { evidencia: 'no', cashIn: true },
    reactivacion_transeunte: { evidencia: 'no', cashIn: true },
    // Compatibilidad build 77 (cliente_antiguo era subtipo de transeunte).
    cliente_antiguo: { evidencia: 'opcional', cashIn: false },
  },
  // Cliente antiguo (cuenta activa): categoría principal, evidencia opcional,
  // sin Cash-In.
  cliente_antiguo: {
    cliente_antiguo: { evidencia: 'opcional', cashIn: false },
  },
};

// Combinación desconocida: criterio conservador (ambas obligatorias).
const REGLA_POR_DEFECTO = { evidencia: 'obligatoria', cashIn: true };

export const resolverReglaFotografias = (tipoGrupo, tipoActivacion) => {
  const grupo = String(tipoGrupo || '').toLowerCase();
  const tipo = String(tipoActivacion || '').toLowerCase();
  const regla = MATRIZ_FOTOGRAFIAS[grupo]?.[tipo] || REGLA_POR_DEFECTO;
  return {
    requiereEvidencia: regla.evidencia === 'obligatoria',
    evidenciaOpcional: regla.evidencia === 'opcional',
    requiereCashIn: regla.cashIn === true,
  };
};
