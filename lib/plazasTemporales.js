import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { normalizarNombreVisible } from './identity';
import { withTimeout } from './asyncTimeout';

const cacheKey = (usuarioId) => `plazas_temporales_${usuarioId}`;
const QUERY_TIMEOUT_MS = 10000;

const leerCache = async (usuarioId) => {
  if (!usuarioId) return [];
  try {
    const raw = await AsyncStorage.getItem(cacheKey(usuarioId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((row) => estaVigente(row)) : [];
  } catch {
    return [];
  }
};

const estaVigente = (row, now = new Date()) => {
  if ('activo' in row && row.activo !== true) return false;
  if ('vigente' in row && row.vigente !== true) return false;
  if (row.cancelado_at) return false;
  const inicio = row.inicio || row.fecha_inicio || row.vigente_desde;
  const fin = row.fin || row.fecha_fin || row.vigente_hasta;
  if (inicio && new Date(inicio) > now) return false;
  if (fin && new Date(fin) < now) return false;
  return true;
};

const normalizarFila = (row) => {
  const relacion = row.plaza || row.plaza_temporal;
  const nombre = normalizarNombreVisible(
    (typeof relacion === 'object' ? relacion?.nombre : relacion)
      || row.nombre_plaza
      || row.nombre
      || ''
  );
  const id = relacion?.id || row.plaza_temporal_id || row.plaza_id || row.id;
  return id && nombre ? {
    id: String(id),
    nombre,
    tipo: row.tipo_zona || row.tipo || 'punto_temporal',
    ciudad_plaza: row.ciudad_plaza || null,
    inicio: row.inicio || row.fecha_inicio || null,
    fin: row.fin || row.fecha_fin || null,
    esTemporal: true,
  } : null;
};

export const obtenerPlazasTemporales = async ({ activadorId, usuarioId }) => {
  const cache = await leerCache(usuarioId);
  if (!activadorId || !usuarioId) return cache;

  try {
    const { data, error } = await withTimeout(
      supabase
        .from('activador_plaza_temporal')
        .select('*')
        .eq('activador_id', activadorId)
        .is('cancelado_at', null),
      QUERY_TIMEOUT_MS,
      'La señal está muy débil para actualizar plazas temporales.'
    );
    if (error) throw error;

    const unicas = new Map();
    (data || []).filter((row) => estaVigente(row)).forEach((row) => {
      const plaza = normalizarFila(row);
      if (plaza) unicas.set(plaza.id, plaza);
    });
    const plazas = [...unicas.values()];
    await AsyncStorage.setItem(cacheKey(usuarioId), JSON.stringify(plazas));
    return plazas;
  } catch (error) {
    console.warn('⚠️ No se pudieron actualizar las plazas temporales:', error?.message || error);
    return cache;
  }
};
