import { z } from 'zod';

/**
 * Environment access, split by trust boundary.
 *
 * `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time.
 * Reading them by their full literal name is required — Next.js substitutes
 * those exact expressions and cannot resolve a dynamic lookup.
 *
 * There is deliberately NO secret/elevated Supabase key anywhere in this
 * application. Every Supabase client it creates uses the publishable key and is
 * therefore subject to Row Level Security. See docs/architecture.md §3.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().or(z.literal('')),
  NEXT_PUBLIC_SITE_URL: z.url().or(z.literal('')),
});

const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? '',
});

export const publicEnv = parsedPublic.success
  ? parsedPublic.data
  : {
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      NEXT_PUBLIC_SITE_URL: '',
    };

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
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length > 0
  );
}

export function requireSupabaseEnv(): { url: string; publishableKey: string } {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).',
    );
  }
  return {
    url: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
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
