import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { normalizarNombreVisible } from './identity';

const cacheKey = (usuarioId) => `plazas_temporales_${usuarioId}`;

const leerCache = async (usuarioId) => {
  if (!usuarioId) return [];
  try {
    const raw = await AsyncStorage.getItem(cacheKey(usuarioId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const estaVigente = (row, now = new Date()) => {
  if ('activo' in row && row.activo !== true) return false;
  if ('vigente' in row && row.vigente !== true) return false;
  const inicio = row.fecha_inicio || row.vigente_desde;
  const fin = row.fecha_fin || row.vigente_hasta;
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
  return id && nombre ? { id: String(id), nombre, esTemporal: true } : null;
};

export const obtenerPlazasTemporales = async ({ activadorId, usuarioId }) => {
  const cache = await leerCache(usuarioId);
  if (!activadorId || !usuarioId) return cache;

  try {
    const { data, error } = await supabase
      .from('activador_plaza_temporal')
      .select('*')
      .eq('activador_id', activadorId);
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
