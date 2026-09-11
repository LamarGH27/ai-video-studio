import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Service-role Supabase client. BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * Nothing in the MVP uses it. It exists as the single, auditable place where
 * the secret key is read, for future back-office work that genuinely cannot run
 * as the signed-in user (scheduled jobs, webhook handlers, delivery uploads).
 *
 * Rules for any future caller:
 *   1. Import only from server code. `server-only` makes a client import a
 *      build error, and eslint.config.mjs additionally blocks the import path.
 *   2. Perform your own authorisation check first — there is no RLS safety net.
 *   3. Never return raw rows from it to a client without filtering by owner.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required only for privileged server-side operations.',
    );
  }

  const { url } = requireSupabaseEnv();

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
