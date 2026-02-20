// lib/config.js
// En builds nativos generados con Gradle, EXPO_PUBLIC_* puede no inyectarse en runtime.
// Por eso soportamos fallback desde app.json -> expo.extra.
import Constants from 'expo-constants';

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

const extra =
  Constants?.expoConfig?.extra
  || Constants?.manifest?.extra
  || Constants?.manifest2?.extra?.expoClient?.extra
  || Constants?.manifest2?.extra
  || {};

// Fallback hardcode para builds release donde no llegan env ni expo extra.
const DEFAULT_SUPABASE_URL = 'https://mjfuiimdiwhzvbnanquu.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qZnVpaW1kaXdoenZibmFucXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI4NTE2OTQsImV4cCI6MjA1ODQyNzY5NH0.PGWk10r1zLXDY3A00kYy7N0gD7lI3abL4S55McKJROg';

const getConfigValue = (envKey, extraKeys = []) => {
  const envValue = process.env?.[envKey];
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue.trim();
  }

  for (const key of extraKeys) {
    const extraValue = extra?.[key];
    if (typeof extraValue === 'string' && extraValue.trim()) {
      return extraValue.trim();
    }
  }

  return '';
};

export const SUPABASE_URL = getConfigValue('EXPO_PUBLIC_SUPABASE_URL', [
  'supabaseUrl',
  'EXPO_PUBLIC_SUPABASE_URL',
]) || DEFAULT_SUPABASE_URL;

export const SUPABASE_KEY = getConfigValue('EXPO_PUBLIC_SUPABASE_ANON_KEY', [
  'supabaseAnonKey',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
]) || DEFAULT_SUPABASE_ANON_KEY;

export const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_KEY);
export const SUPABASE_CONFIG_ERROR = HAS_SUPABASE_CONFIG
  ? ''
  : 'Falta configuración de Supabase (URL o ANON KEY). Revisa EXPO_PUBLIC_* o expo.extra en app.json.';

if (!HAS_SUPABASE_CONFIG) {
  if (isDev) {
    console.warn(`⚠️ ${SUPABASE_CONFIG_ERROR}`);
  } else {
    console.error(`❌ ${SUPABASE_CONFIG_ERROR}`);
  }
}
