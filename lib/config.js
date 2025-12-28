// lib/config.js
// Centraliza las credenciales de Supabase con posibilidad de inyectarlas por entorno.
// Usa variables EXPO_PUBLIC_* para que estén disponibles en el bundle sin hardcodear.

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://mjfuiimdiwhzvbnanquu.supabase.co';

export const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qZnVpaW1kaXdoenZibmFucXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI4NTE2OTQsImV4cCI6MjA1ODQyNzY5NH0.PGWk10r1zLXDY3A00kYy7N0gD7lI3abL4S55McKJROg';
