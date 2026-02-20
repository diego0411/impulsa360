import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL,
  SUPABASE_KEY,
  HAS_SUPABASE_CONFIG,
  SUPABASE_CONFIG_ERROR,
} from './config';

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
        storage: AsyncStorage,
      };

const configError = { message: SUPABASE_CONFIG_ERROR || 'Configuración de Supabase faltante.' };

const createQueryStub = () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
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
  },
  from: () => createQueryStub(),
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
