import { expect, type Page } from '@playwright/test';

/**
 * Credentials for the authenticated specs.
 *
 * These specs need a live Supabase project with the migrations applied and a
 * confirmed test user. When the variables are absent the specs skip with a
 * reason rather than failing, so `npm run test:e2e` is still useful on a fresh
 * clone — see docs/architecture.md for how to set them up.
 */
export const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? '';
export const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

export const hasTestCredentials = E2E_USER_EMAIL.length > 0 && E2E_USER_PASSWORD.length > 0;

/**
 * Whether the app under test is wired to a Supabase project at all. Specs that
 * exercise real authentication responses need this; route-protection specs do not.
 */
export const hasSupabaseConfig =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').length > 0 &&
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').length > 0;

export const SUPABASE_SKIP_REASON =
  'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to run this spec.';

export const SKIP_REASON =
  'Set E2E_USER_EMAIL and E2E_USER_PASSWORD against a Supabase project with the migrations applied.';

export async function signIn(page: Page, next = '/dashboard'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(E2E_USER_EMAIL);
  await page.getByLabel('Password').fill(E2E_USER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

/** A JPEG small enough to inline, used as a reference image upload. */
export function tinyJpeg(): Buffer {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, 'page should not scroll horizontally').toBe(false);
}
