import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from './config';

/**
 * Supabase client for Server Components and Server Actions. It runs as the logged-in user, so Row Level Security applies.
 * Create a new one per request. Server Components cannot write cookies; the proxy refreshes the session instead.
 */
export async function createSupabaseServerClient() {
  const { url, key } = supabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: ignored, the proxy keeps the session fresh.
        }
      },
    },
  });
}
