import { NativeModules, Platform } from 'react-native';

// Puente JS mínimo para ApplicationExitInfo (Android API >= 30).
// En iOS, API < 30 o módulo ausente retorna unsupported sin fallar.
// timestamp: epoch ms del registro (0 = sin registro atribuible).
// description: process state summary recortado (sin datos sensibles).
// pid: pid del proceso fallecido (0 = desconocido).
const FALLBACK = { supported: false, reason: 'UNSUPPORTED', timestampMs: 0, exitIso: null, description: '', pid: 0 };

export const getPreviousExitReason = async () => {
  try {
    if (Platform.OS !== 'android') return { ...FALLBACK };
    const mod = NativeModules?.ImpulsaExitInfo;
    if (!mod?.getPreviousExitReason) return { ...FALLBACK };
    const result = await mod.getPreviousExitReason();
    const reason = String(result?.reason || 'OTHER');
    const validos = new Set(['CRASH', 'CRASH_NATIVE', 'ANR', 'LOW_MEMORY', 'USER_REQUESTED', 'OTHER', 'UNSUPPORTED']);
    const timestampMs = Number(result?.timestamp || 0);
    const exitIso = Number.isFinite(timestampMs) && timestampMs > 0
      ? new Date(timestampMs).toISOString()
      : null;
    return {
      supported: result?.supported === true,
      reason: validos.has(reason) ? reason : 'OTHER',
      timestampMs: Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : 0,
      exitIso,
      description: String(result?.description || '').slice(0, 240),
      pid: Number(result?.pid || 0),
    };
  } catch {
    return { ...FALLBACK };
  }
};

export const setExitSummary = async (summary) => {
  try {
    if (Platform.OS !== 'android') return;
    const mod = NativeModules?.ImpulsaExitInfo;
    if (!mod?.setExitSummary) return;
    await mod.setExitSummary(String(summary || '').slice(0, 64));
  } catch {
    // best-effort
  }
};
