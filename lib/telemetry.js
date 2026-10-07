import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';

const OUTBOX_KEY = 'telemetry_outbox_v1';
const RUN_CURRENT_KEY = 'telemetry_run_current_v1';
const RUN_PREV_KEY = 'telemetry_run_prev_v1';
const MAX_EVENTOS = 100;
const MAX_BYTES = 64 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BATCH = 20;

const EVENTOS_PERMITIDOS = new Set([
  'app_start',
  'app_background',
  'app_foreground',
  'form_edit',
  'draft_write_ok',
  'draft_write_error',
  'photo_process_start',
  'photo_process_ok',
  'photo_process_error',
  'sync_start',
  'sync_upload_start',
  'sync_upload_ok',
  'sync_upload_error',
  'sync_end',
  'auth_change',
  'logout',
  'error_boundary',
  'previous_run_unclean',
]);

const bucketPendientes = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v === 1) return '1';
  if (v <= 5) return '2-5';
  if (v <= 20) return '6-20';
  return '>20';
};

const bucketFoto = (bytes) => {
  const v = Number(bytes);
  if (!Number.isFinite(v) || v <= 0) return 'unknown';
  if (v < 512 * 1024) return '<0.5MB';
  if (v < 2 * 1024 * 1024) return '0.5-2MB';
  if (v < 6 * 1024 * 1024) return '2-6MB';
  return '>6MB';
};

let runId = null;
let lastFormEditAt = 0;
// Marcador del run previo capturado en init: { run_id, started_at, last_state, clean_background }.
// Lo lee App.js para correlacionar ApplicationExitInfo temporalmente.
let prevRunMarker = null;
let flushEnVuelo = null;

const safeParse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const getRunId = () => runId;

export const getPreviousRunMarker = () => prevRunMarker;

export const pendingCountBucket = (n) => bucketPendientes(n);
export const photoSizeBucket = (bytes) => bucketFoto(bytes);

async function leerOutbox() {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    const arr = safeParse(raw, []);
    if (!Array.isArray(arr)) return [];
    const ahora = Date.now();
    return arr.filter((e) => e && ahora - new Date(e.occurred_at).getTime() < TTL_MS);
  } catch {
    return [];
  }
}

async function escribirOutbox(eventos) {
  try {
    let recorte = Array.isArray(eventos) ? eventos.slice(-MAX_EVENTOS) : [];
    let json = JSON.stringify(recorte);
    while (recorte.length > 0 && json.length > MAX_BYTES) {
      recorte = recorte.slice(1);
      json = JSON.stringify(recorte);
    }
    await AsyncStorage.setItem(OUTBOX_KEY, json);
  } catch {
    // Telemetría nunca bloquea.
  }
}

const versionApp = () => String(
  Constants.nativeBuildVersion || Constants.expoConfig?.version || 'desconocida'
);
const buildApp = () => String(
  Constants.nativeBuildVersion || Constants.expoConfig?.android?.versionCode || 'desconocido'
);

export async function initTelemetry() {
  try {
    runId = uuidv4();
    let previo = null;
    try {
      const rawPrev = await AsyncStorage.getItem(RUN_CURRENT_KEY);
      previo = rawPrev ? JSON.parse(rawPrev) : null;
    } catch {
      previo = null;
    }
    // Se conserva para correlación en App.js; el evento previous_run_unclean
    // se emite UNA sola vez desde App.js (con o sin motivo nativo).
    prevRunMarker = previo?.run_id ? previo : null;
    try {
      if (previo?.run_id) {
        await AsyncStorage.setItem(RUN_PREV_KEY, JSON.stringify(previo));
      }
      await AsyncStorage.setItem(
        RUN_CURRENT_KEY,
        JSON.stringify({ run_id: runId, started_at: new Date().toISOString(), last_state: 'starting', clean_background: false })
      );
    } catch {
      // best-effort
    }
    await recordEvent('app_start', { app_state: 'active', phase: 'startup' });
  } catch {
    // Nunca bloquear arranque.
  }
}

export async function updateRunMarker(patch = {}) {
  try {
    const raw = await AsyncStorage.getItem(RUN_CURRENT_KEY);
    const actual = raw ? safeParse(raw, {}) : {};
    await AsyncStorage.setItem(
      RUN_CURRENT_KEY,
      JSON.stringify({ ...actual, run_id: runId || actual?.run_id, ...patch })
    );
  } catch {
    // best-effort
  }
}

export async function recordEvent(nombre, campos = {}) {
  try {
    if (!EVENTOS_PERMITIDOS.has(nombre)) return;
    // form_edit throttled: máximo 1 cada 30s, nunca por tecla.
    if (nombre === 'form_edit') {
      const ahora = Date.now();
      if (ahora - lastFormEditAt < 30000) return;
      lastFormEditAt = ahora;
    }
    const evento = {
      event_id: uuidv4(),
      event_name: nombre,
      occurred_at: new Date().toISOString(),
      run_id: runId,
      app_version: versionApp(),
      build_number: buildApp(),
      platform: Platform.OS,
      os_version: String(Platform.Version ?? ''),
      app_state: typeof campos.app_state === 'string' ? campos.app_state.slice(0, 16) : 'unknown',
      screen: typeof campos.screen === 'string' ? campos.screen.slice(0, 32) : undefined,
      phase: typeof campos.phase === 'string' ? campos.phase.slice(0, 32) : undefined,
      pending_count_bucket: typeof campos.pending_count_bucket === 'string' ? campos.pending_count_bucket.slice(0, 8) : undefined,
      photo_size_bucket: typeof campos.photo_size_bucket === 'string' ? campos.photo_size_bucket.slice(0, 8) : undefined,
      sync_stage: typeof campos.sync_stage === 'string' ? campos.sync_stage.slice(0, 32) : undefined,
      error_category: typeof campos.error_category === 'string' ? campos.error_category.slice(0, 32) : undefined,
      native_exit_reason: typeof campos.native_exit_reason === 'string' ? campos.native_exit_reason.slice(0, 16) : undefined,
      previous_last_state: typeof campos.previous_last_state === 'string' ? campos.previous_last_state.slice(0, 16) : undefined,
      exit_timestamp: typeof campos.exit_timestamp === 'string' ? campos.exit_timestamp.slice(0, 32) : undefined,
    };
    Object.keys(evento).forEach((k) => {
      if (evento[k] === undefined) delete evento[k];
    });
    const outbox = await leerOutbox();
    const ultimo = outbox[outbox.length - 1];
    const fingerprint = `${evento.event_name}|${evento.sync_stage || ''}|${evento.error_category || ''}`;
    const lastFingerprint = ultimo
      ? `${ultimo.event_name}|${ultimo.sync_stage || ''}|${ultimo.error_category || ''}`
      : '';
    if (ultimo && fingerprint === lastFingerprint) {
      const tUltimo = new Date(ultimo.occurred_at).getTime();
      if (Date.now() - tUltimo < 15 * 60 * 1000) {
        ultimo.occurrence_count = Number(ultimo.occurrence_count || 1) + 1;
        await escribirOutbox(outbox);
        return;
      }
    }
    outbox.push({ ...evento, occurrence_count: 1 });
    await escribirOutbox(outbox);
  } catch {
    // Telemetría nunca lanza.
  }
}

export async function flushTelemetry() {
  // Single-flight: dos flush simultáneos comparten la misma promesa y nunca
  // procesan el mismo outbox en paralelo (anti-duplicados).
  if (flushEnVuelo) return flushEnVuelo;
  flushEnVuelo = ejecutarFlush();
  try {
    return await flushEnVuelo;
  } finally {
    flushEnVuelo = null;
  }
}

async function ejecutarFlush() {
  try {
    const outbox = await leerOutbox();
    if (!outbox.length) return { sent: 0 };
    const lote = outbox.slice(0, MAX_BATCH);
    const payload = lote.map((e) => ({
      event_id: e.event_id,
      event_name: e.event_name,
      occurred_at: e.occurred_at,
      run_id: e.run_id,
      app_version: e.app_version,
      build_number: e.build_number,
      platform: e.platform,
      os_version: e.os_version,
      app_state: e.app_state,
      screen: e.screen,
      phase: e.phase,
      pending_count_bucket: e.pending_count_bucket,
      photo_size_bucket: e.photo_size_bucket,
      sync_stage: e.sync_stage,
      error_category: e.error_category,
      native_exit_reason: e.native_exit_reason,
      previous_last_state: e.previous_last_state,
      exit_timestamp: e.exit_timestamp,
      occurrence_count: e.occurrence_count || 1,
    }));
    const promesa = supabase.rpc('registrar_eventos_telemetria', { p_eventos: payload });
    const timeout = new Promise((_, reject) => {
      globalThis.setTimeout(() => reject(new Error('telemetry timeout')), 5000);
    });
    const { error } = await Promise.race([promesa, timeout]);
    if (error) return { sent: 0 };
    await escribirOutbox(outbox.slice(lote.length));
    return { sent: lote.length };
  } catch {
    return { sent: 0 };
  }
}
