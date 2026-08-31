import { supabase } from './supabase';
import { withTimeout } from './asyncTimeout';

const QUERY_TIMEOUT_MS = 10000;
const DIAS_MINIMOS_REACTIVACION = 90;

export const normalizarCiCliente = (value) =>
  String(value || '')
    .trim()
    .replace(/[^0-9a-zA-Z]/g, '')
    .toUpperCase();

export const normalizarTelefonoCliente = (value) =>
  String(value || '').replace(/\D/g, '').slice(-8);

export const requiereValidacionReactivacion = (tipoActivacion) => {
  const tipo = String(tipoActivacion || '').toLowerCase();
  return tipo.includes('reactivacion') || tipo === 'reimpresion_qr';
};

const fechaIsoLocal = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const fechaLimiteReactivacion = (baseDate = new Date()) => {
  const limite = new Date(baseDate);
  limite.setDate(limite.getDate() - DIAS_MINIMOS_REACTIVACION);
  return fechaIsoLocal(limite);
};

const fechaRegistro = (item) => String(item?.fecha_activacion || item?.created_at || '').slice(0, 10);

export const mensajeBloqueoReactivacion = (fecha) =>
  `Este cliente ya registra una activación reciente (${fecha}). Deben pasar al menos ${DIAS_MINIMOS_REACTIVACION} días para reactivación o reimpresión.`;

export const validarElegibilidadReactivacion = async ({
  ci,
  telefono,
  tipoActivacion,
  registroId,
  fechaReferencia,
} = {}) => {
  if (!requiereValidacionReactivacion(tipoActivacion)) {
    return { ok: true, requiereValidacion: false };
  }

  const ciNormalizado = normalizarCiCliente(ci);
  const telefonoNormalizado = normalizarTelefonoCliente(telefono);
  if (!ciNormalizado && !telefonoNormalizado) {
    return { ok: true, requiereValidacion: true };
  }

  const { data, error } = await withTimeout(
    supabase.rpc('validar_elegibilidad_reactivacion', {
      p_ci: ciNormalizado || null,
      p_telefono: telefonoNormalizado || null,
      p_tipo_activacion: tipoActivacion || null,
      p_fecha_referencia: fechaReferencia || null,
      p_registro_id: registroId || null,
    }),
    QUERY_TIMEOUT_MS,
    'La señal está muy débil para validar reactivación.'
  );

  if (error) throw error;

  const resultado = Array.isArray(data) ? data[0] : data;
  const eligible = resultado?.eligible !== false;

  if (!eligible) {
    const fecha = fechaRegistro({ fecha_activacion: resultado?.previous_activation_date });
    return {
      ok: false,
      requiereValidacion: true,
      fecha,
      mensaje: mensajeBloqueoReactivacion(fecha),
    };
  }

  return { ok: true, requiereValidacion: true };
};
