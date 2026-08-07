import { supabase } from './supabase';

function parseFechaISO(value) {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function pickNotificacionPayload(row) {
  if (!row) return null;
  const joined = row.notificacion ?? row.notificaciones ?? null;
  if (Array.isArray(joined)) return joined[0] ?? null;
  return joined;
}

function normalizarFila(row) {
  const payload = pickNotificacionPayload(row);
  const fecha = row?.enviada_at || payload?.created_at || null;

  return {
    destinatarioId: row?.id,
    notificacionId: row?.notificacion_id,
    titulo: String(payload?.titulo || 'Notificación').trim(),
    mensaje: String(payload?.mensaje || '').trim(),
    fecha,
    leidaAt: row?.leida_at || null,
    isRead: !!row?.leida_at,
    raw: row,
  };
}

function ordenarPorFechaDesc(a, b) {
  return parseFechaISO(b?.fecha) - parseFechaISO(a?.fecha);
}

export async function obtenerNotificacionesUsuario(usuarioId) {
  if (!usuarioId) {
    throw new Error('Usuario requerido para consultar notificaciones.');
  }

  const { data: destinatarios, error: destinatariosError } = await supabase
    .from('notificaciones_destinatarios')
    .select('id, usuario_id, notificacion_id, enviada_at, leida_at')
    .eq('usuario_id', usuarioId);

  if (destinatariosError) {
    throw destinatariosError;
  }

  const filasDest = Array.isArray(destinatarios) ? destinatarios : [];
  if (filasDest.length === 0) return [];

  const notificacionIds = [...new Set(filasDest.map((row) => row?.notificacion_id).filter(Boolean))];
  if (notificacionIds.length === 0) {
    return filasDest.map((row) => normalizarFila(row)).sort(ordenarPorFechaDesc);
  }

  const { data: notificaciones, error: notificacionesError } = await supabase
    .from('notificaciones')
    .select('id, titulo, mensaje, created_at')
    .in('id', notificacionIds);

  if (notificacionesError) {
    throw notificacionesError;
  }

  const mapaNotificaciones = new Map(
    (Array.isArray(notificaciones) ? notificaciones : []).map((n) => [n.id, n])
  );

  const filas = filasDest.map((row) => ({
    ...row,
    notificacion: mapaNotificaciones.get(row.notificacion_id) || null,
  }));

  return filas.map(normalizarFila).sort(ordenarPorFechaDesc);
}

export async function marcarNotificacionLeida(destinatarioId) {
  if (!destinatarioId) {
    throw new Error('Id de destinatario requerido.');
  }

  const timestamp = new Date().toISOString();

  const { data, error } = await supabase
    .from('notificaciones_destinatarios')
    .update({ leida_at: timestamp })
    .eq('id', destinatarioId)
    .is('leida_at', null)
    .select('id, leida_at');

  if (error) {
    throw error;
  }

  // Idempotencia: si no afecta filas, asumimos que ya estaba leída.
  if (!Array.isArray(data) || data.length === 0) {
    return { id: destinatarioId, leida_at: null, status: 'already_read' };
  }

  return { id: data[0]?.id ?? destinatarioId, leida_at: data[0]?.leida_at ?? timestamp, status: 'updated' };
}

export async function obtenerConteoNoLeidas(usuarioId) {
  if (!usuarioId) return 0;

  const { count, error } = await supabase
    .from('notificaciones_destinatarios')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', usuarioId)
    .is('leida_at', null);

  if (error) {
    throw error;
  }

  return Number(count || 0);
}

export async function obtenerConteoDestinatariosSinId(usuarioId) {
  if (!usuarioId) return 0;

  const { count, error } = await supabase
    .from('notificaciones_destinatarios')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', usuarioId)
    .is('id', null);

  if (error) {
    throw error;
  }

  return Number(count || 0);
}
