import { z } from 'zod';

/**
 * Environment access, split by trust boundary.
 *
 * `publicEnv` holds values that are inlined into the browser bundle. Reading
 * `process.env.NEXT_PUBLIC_*` by its full literal name is required — Next.js
 * replaces those expressions at build time and cannot resolve dynamic lookups.
 *
 * `serverEnv()` is never imported from a "use client" module. See
 * lib/supabase/admin.ts for the one consumer of the service-role key.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().or(z.literal('')),
  NEXT_PUBLIC_SITE_URL: z.url().or(z.literal('')),
});

const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? '',
});

export const publicEnv = parsedPublic.success
  ? parsedPublic.data
  : { NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', NEXT_PUBLIC_SITE_URL: '' };

/**
 * True when Supabase credentials are present.
 *
 * The public marketing pages must render without them so that `next build`,
 * Vercel preview deployments and the public Playwright specs do not require a
 * live project. Everything behind auth checks this and fails loudly instead.
 */
export function isSupabaseConfigured(): boolean {
  return (
    publicEnv.NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY.length > 0
  );
}

export function requireSupabaseEnv(): { url: string; anonKey: string } {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).',
    );
  }
  return {
    url: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Absolute origin used to build auth redirect URLs. */
export function siteUrl(): string {
  if (publicEnv.NEXT_PUBLIC_SITE_URL) {
    return publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  }
  // Vercel injects this for preview deployments where the URL is not known ahead of time.
  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return 'http://localhost:3000';
}
