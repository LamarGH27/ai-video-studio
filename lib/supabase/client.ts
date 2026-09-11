'use client';

import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Browser Supabase client. Uses the publishable key, which is designed to be
 * public — every request it makes is still constrained by Row Level Security.
 *
 * This application has no secret Supabase key at all, so there is nothing here
 * that could leak one.
 */
export function createClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
