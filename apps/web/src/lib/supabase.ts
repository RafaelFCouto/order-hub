import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

if (!supabaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    'Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em apps/web/.env (ver docs/SUPABASE.md)',
  );
}

// fallback com URL válida só pra não quebrar o render quando faltar env
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
);
