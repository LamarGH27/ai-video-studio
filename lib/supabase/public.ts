import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Sessionless publishable-key client for public marketing reads (portfolio, experience
 * catalogue).
 *
 * It deliberately does not touch cookies, so pages using it can still be
 * statically rendered and revalidated instead of becoming dynamic. It sees
 * exactly what an anonymous visitor is allowed to see under RLS: active
 * portfolio items and active experiences, nothing else.
 */
export function createPublicClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  return createSupabaseClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
