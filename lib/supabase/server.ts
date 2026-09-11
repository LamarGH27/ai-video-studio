import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { requireSupabaseEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers. Reads the session from the request cookies, so every query it
 * runs is executed as the signed-in user and is subject to Row Level Security.
 *
 * Never cache the returned client across requests — it is bound to one cookie jar.
 */
export async function createClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session on every request, so it is safe to ignore here.
        }
      },
    },
  });
}
