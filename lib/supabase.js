import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config';

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

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: authOptions,
});
