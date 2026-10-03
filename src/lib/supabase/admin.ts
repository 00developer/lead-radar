import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '../app/server';
import { requireValue } from '../env';

/**
 * Supabase client with the service role key. It bypasses Row Level Security and can create users, so it is used only on
 * the server, only in the signup action and only after an invite was claimed. Never import this from a Client Component.
 */
export function createSupabaseAdmin() {
  const env = serverEnv();
  return createClient(requireValue(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'), requireValue(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
