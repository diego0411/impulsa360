import { NativeModules, Platform } from 'react-native';

// Puente JS mínimo para ApplicationExitInfo (Android API >= 30).
// En iOS, API < 30 o módulo ausente retorna unsupported sin fallar.
export const getPreviousExitReason = async () => {
  try {
    if (Platform.OS !== 'android') return { supported: false, reason: 'UNSUPPORTED' };
    const mod = NativeModules?.ImpulsaExitInfo;
    if (!mod?.getPreviousExitReason) return { supported: false, reason: 'UNSUPPORTED' };
    const result = await mod.getPreviousExitReason();
    const reason = String(result?.reason || 'OTHER');
    const validos = new Set(['CRASH', 'CRASH_NATIVE', 'ANR', 'LOW_MEMORY', 'USER_REQUESTED', 'OTHER', 'UNSUPPORTED']);
    return { supported: result?.supported === true, reason: validos.has(reason) ? reason : 'OTHER' };
  } catch {
    return { supported: false, reason: 'UNSUPPORTED' };
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
