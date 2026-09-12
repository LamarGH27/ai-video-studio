import { expect, type Page } from '@playwright/test';

/**
 * Credentials for the three test principals.
 *
 * The authenticated specs need a live Supabase project with the migrations
 * applied and three confirmed users (Customer A, Customer B, Admin — the admin
 * promoted via the documented SQL, since no application path can grant a role).
 *
 * When the variables are absent those specs skip with a printed reason rather
 * than failing, so `npm run test:e2e` is still useful on a fresh clone. Use
 * throwaway accounts on a non-production project.
 */
export interface Principal {
  email: string;
  password: string;
}

function principal(prefix: string): Principal {
  return {
    email: process.env[`${prefix}_EMAIL`] ?? '',
    password: process.env[`${prefix}_PASSWORD`] ?? '',
  };
}

export const CUSTOMER_A = principal('E2E_CUSTOMER_A');
export const CUSTOMER_B = principal('E2E_CUSTOMER_B');
export const ADMIN = principal('E2E_ADMIN');

const complete = (p: Principal) => p.email.length > 0 && p.password.length > 0;

export const hasCustomerA = complete(CUSTOMER_A);
export const hasBothCustomers = complete(CUSTOMER_A) && complete(CUSTOMER_B);
export const hasAdmin = complete(ADMIN);

export const SKIP_CUSTOMER_A =
  'Set E2E_CUSTOMER_A_EMAIL / E2E_CUSTOMER_A_PASSWORD against a Supabase project with the migrations applied.';
export const SKIP_BOTH_CUSTOMERS =
  'Set E2E_CUSTOMER_A_* and E2E_CUSTOMER_B_* to run cross-customer isolation specs.';
export const SKIP_ADMIN =
  'Set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD for an account promoted to the admin role.';

/**
 * Whether the app under test is wired to a Supabase project at all. Specs that
 * exercise real authentication responses need this; route-protection specs do not.
 */
export const hasSupabaseConfig =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').length > 0 &&
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').length > 0;

export const SUPABASE_SKIP_REASON =
  'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to run this spec.';

export async function signIn(page: Page, who: Principal, next = '/dashboard'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

export async function signOut(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/', { timeout: 20_000 });
}

/** A 1x1 JPEG — small enough to inline, real enough to upload. */
export function tinyJpeg(): Buffer {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
}

/**
 * Drives the create flow from step 1 to a submitted project.
 * Returns the resulting project URL and its public reference.
 */
export async function createAndSubmitProject(
  page: Page,
  brief: string,
): Promise<{ url: string; reference: string }> {
  await page.goto('/create');

  await page.getByText('Luxury Lifestyle', { exact: true }).first().click();
  await page.getByRole('button', { name: /Continue to your brief/ }).click();

  await page.getByLabel('Your brief').fill(brief);
  await page.getByLabel('Mood').fill('Confident');
  await page.getByText('Vertical 9:16').click();
  await page.getByText('15 seconds').click();
  await page.getByRole('button', { name: /Continue to reference images/ }).click();

  await expect(page.getByRole('heading', { name: /Upload your reference images/ })).toBeVisible({
    timeout: 20_000,
  });

  // Count relative to what is already there. These specs run against a shared
  // project, and a previous run may have left an unfinished draft carrying
  // images — asserting an absolute "1 of 10" would be flaky by design.
  const uploaded = page.getByRole('button', { name: /^Remove / });
  const before = await uploaded.count();

  await page.setInputFiles('#reference-images', {
    name: 'reference.jpg',
    mimeType: 'image/jpeg',
    buffer: tinyJpeg(),
  });
  await expect(uploaded).toHaveCount(before + 1, { timeout: 30_000 });

  await page.getByRole('button', { name: /Continue to review/ }).click();

  await page.getByRole('checkbox', { name: /I confirm that I am the person shown/ }).click();
  await page.getByRole('checkbox', { name: /I consent to these images being processed/ }).click();
  await page.getByRole('button', { name: 'Submit Project' }).click();

  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]+/, { timeout: 30_000 });

  // Anchored. A bare /AVS-\d{6}/ also matches every ancestor whose text merely
  // contains the reference; `^...$` matches only the element whose entire text
  // is the reference itself, so no .first() guess is needed.
  const reference = (await page.getByText(/^AVS-\d{6}$/).textContent()) ?? '';
  return { url: page.url(), reference: reference.trim() };
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, 'page should not scroll horizontally').toBe(false);
}
