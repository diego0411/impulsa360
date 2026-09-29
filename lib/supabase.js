import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { secureLocalStorage } from './secureLocalStorage';
import {
  SUPABASE_URL,
  SUPABASE_KEY,
  HAS_SUPABASE_CONFIG,
  SUPABASE_CONFIG_ERROR,
} from './config';

const supabaseProjectRef = (() => {
  const match = String(SUPABASE_URL || '').match(/^https?:\/\/([^.]+)\.supabase\.co(?:\/|$)/i);
  return match?.[1] || 'impulsa360';
})();
const SUPABASE_AUTH_STORAGE_KEY = `sb-${supabaseProjectRef}-auth-token`;

const authOptions =
  Platform.OS === 'web'
    ? {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        // En web supabase usa localStorage por defecto; no forzamos AsyncStorage
      }
    : {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        storage: secureLocalStorage,
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      };

const configError = { message: SUPABASE_CONFIG_ERROR || 'Configuración de Supabase faltante.' };

const createQueryStub = () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    neq: () => builder,
    or: () => builder,
    gte: () => builder,
    lte: () => builder,
    lt: () => builder,
    order: () => builder,
    limit: async () => ({ data: [], error: configError }),
    range: async () => ({ data: [], error: configError }),
    single: async () => ({ data: null, error: configError }),
    upsert: async () => ({ data: null, error: configError }),
  };
  return builder;
};

const storageBucketStub = {
  getPublicUrl: () => ({ data: { publicUrl: '' } }),
  createSignedUrl: async () => ({ data: null, error: configError }),
  upload: async () => ({ data: null, error: configError }),
};

const supabaseStub = {
  auth: {
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: configError }),
    getSession: async () => ({ data: { session: null }, error: configError }),
    getUser: async () => ({ data: { user: null }, error: configError }),
    signOut: async () => ({ error: null }),
    startAutoRefresh: async () => {},
    stopAutoRefresh: async () => {},
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: () => createQueryStub(),
  rpc: async () => ({ data: null, error: configError }),
  storage: {
    from: () => storageBucketStub,
  },
  channel: () => ({
    on() {
      return this;
    },
    subscribe() {
      return {};
    },
  }),
  removeChannel: () => {},
};

export const supabase = HAS_SUPABASE_CONFIG
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: authOptions })
  : supabaseStub;

export const clearLocalSupabaseSession = async () => {
  const keys = [
    SUPABASE_AUTH_STORAGE_KEY,
    `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`,
  ];
  await Promise.all(keys.map((key) => secureLocalStorage.removeItem(key)));
  const remaining = await Promise.all(keys.map((key) => secureLocalStorage.getRawItem(key)));
  if (remaining.some((value) => value !== null)) {
    throw new Error('No se pudo eliminar la sesión local del dispositivo.');
  }
};
