import { expect, test } from '@playwright/test';
import { SUPABASE_SKIP_REASON, hasSupabaseConfig } from './helpers';

/**
 * Route protection. No credentials needed — the point is that an anonymous
 * visitor is turned away and told where to sign in back to.
 */

test('an unauthenticated visitor is sent to sign in from the dashboard', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('an unauthenticated visitor cannot reach another customer’s project URL', async ({ page }) => {
  const someoneElsesProject = '/dashboard/projects/00000000-1111-4222-8333-444444444444';
  await page.goto(someoneElsesProject);

  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page).not.toHaveURL(new RegExp(someoneElsesProject));
});

test('an unauthenticated visitor is sent to sign in from the admin area', async ({ page }) => {
  await page.goto('/admin');

  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
});

test('the sign-in page offers account creation and password recovery', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('link', { name: 'Create one' })).toBeVisible();
  await page.getByRole('link', { name: 'Forgotten your password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
});

test('sign-in rejects bad credentials without saying whether the account exists', async ({
  page,
}) => {
  // Needs a real Auth server to answer; route protection above does not.
  test.skip(!hasSupabaseConfig, SUPABASE_SKIP_REASON);

  await page.goto('/login');
  await page.getByLabel('Email').fill('definitely-not-a-user@example.com');
  await page.getByLabel('Password').fill('an-incorrect-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(alert).toContainText(/email or password is incorrect/i);
  // Must not distinguish "no such account" from "wrong password".
  await expect(alert).not.toContainText(/not found|no account|unregistered/i);
});
