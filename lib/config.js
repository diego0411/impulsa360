// lib/config.js
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

const getConfigValue = (envValue) => {
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue.trim();
  }
  return '';
};

export const SUPABASE_URL = getConfigValue(process.env.EXPO_PUBLIC_SUPABASE_URL);

export const SUPABASE_KEY = getConfigValue(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_KEY);
export const SUPABASE_CONFIG_ERROR = HAS_SUPABASE_CONFIG
  ? ''
  : 'Falta configuración de Supabase. Define EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY en el entorno de Expo/EAS.';

if (!HAS_SUPABASE_CONFIG) {
  if (isDev) {
    console.warn(`⚠️ ${SUPABASE_CONFIG_ERROR}`);
  } else {
    console.error(`❌ ${SUPABASE_CONFIG_ERROR}`);
  }
}
