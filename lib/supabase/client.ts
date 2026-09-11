'use client';

import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Browser Supabase client. Uses the publishable (anon) key only — every request
 * it makes is subject to Row Level Security. The service-role key must never
 * reach this file or anything it imports.
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
