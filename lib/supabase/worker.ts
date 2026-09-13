import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from '@/lib/env';
import { supabaseSecretKey } from '@/lib/notifications/config';
import type { Database } from '@/types/database';

/**
 * The queue runner's Supabase client. NOT for request handling.
 *
 * Everything else in this application talks to Supabase as the signed-in user,
 * under RLS. This client does not, because the notification worker is not a
 * user — no session exists to act as, and the rows it drains belong to whoever
 * happened to trigger them.
 *
 * The compensating controls, since this key bypasses RLS:
 *
 *   * It is used by exactly one route, which verifies CRON_SECRET in constant
 *     time before this module is reached.
 *   * The worker only ever calls three SECURITY DEFINER functions, each of
 *     which is granted to service_role alone and does one bounded thing.
 *   * notification_outbox has no INSERT, UPDATE or DELETE policy for any role,
 *     so even reachable through PostgREST there is no table-level write path.
 *   * tests/notification-config.test.ts fails if the variable name is ever
 *     prefixed NEXT_PUBLIC_, or if a client-reachable module imports this file.
 *
 * If the key is absent the worker fails loudly. It does not fall back to the
 * publishable key, which would silently see nothing and report an empty queue.
 */
export function createWorkerClient() {
  const { url } = requireSupabaseEnv();
  const secret = supabaseSecretKey();

  if (!secret) {
    throw new Error(
      'SUPABASE_SECRET_KEY is not set. The notification worker cannot read the outbox without it (see docs/notifications.md).',
    );
  }

  return createSupabaseClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'avs-notification-worker' } },
  });
}
