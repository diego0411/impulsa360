import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mjfuiimdiwhzvbnanquu.supabase.co'; // reemplaza
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qZnVpaW1kaXdoenZibmFucXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI4NTE2OTQsImV4cCI6MjA1ODQyNzY5NH0.PGWk10r1zLXDY3A00kYy7N0gD7lI3abL4S55McKJROg'; // reemplaza

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
