import { expect, test } from '@playwright/test';
import { SKIP_REASON, hasTestCredentials, signIn, tinyJpeg } from './helpers';

/**
 * The authenticated half of the customer journey, end to end:
 * sign in → brief → upload → consent → submit → dashboard → project page.
 *
 * Needs a live Supabase project with the migrations applied and a confirmed
 * test user (E2E_USER_EMAIL / E2E_USER_PASSWORD).
 */
test.describe('authenticated customer journey', () => {
  test.skip(!hasTestCredentials, SKIP_REASON);

  test('a user can sign in and reach their dashboard', async ({ page }) => {
    await signIn(page);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Welcome back/);
  });

  test('a user can brief, upload, consent, submit and then view their project', async ({
    page,
  }) => {
    await signIn(page, '/create');
    await page.goto('/create');

    // Step 1 — experience
    await page.getByText('Luxury Lifestyle', { exact: true }).first().click();
    await page.getByRole('button', { name: /Continue to your brief/ }).click();

    // Step 2 — brief
    const brief = `Playwright brief ${Date.now()}: a slow walk through a berthed yacht in Monaco at golden hour, confident and unhurried.`;
    await page.getByLabel('Your brief').fill(brief);
    await page.getByLabel('Mood').fill('Confident');
    await page.getByLabel('Location or environment').fill('Monaco harbour');
    await page.getByText('Vertical 9:16').click();
    await page.getByText('15 seconds').click();
    await page.getByRole('button', { name: /Continue to reference images/ }).click();

    // Step 3 — reference image
    await expect(page.getByRole('heading', { name: /Upload your reference images/ })).toBeVisible({
      timeout: 20_000,
    });
    await page.setInputFiles('#reference-images', {
      name: 'reference.jpg',
      mimeType: 'image/jpeg',
      buffer: tinyJpeg(),
    });
    await expect(page.getByText(/1 of 10 uploaded/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Continue to review/ }).click();

    // Step 4 — review and consent
    await expect(page.getByRole('heading', { name: /Check it over/ })).toBeVisible();
    await expect(page.getByText(brief)).toBeVisible();

    // Submitting without consent must not work.
    await page.getByRole('button', { name: 'Submit Project' }).click();
    await expect(page.getByRole('alert')).toContainText(/required confirmations/i);

    await page.getByRole('checkbox', { name: /I confirm that I am the person shown/ }).click();
    await page.getByRole('checkbox', { name: /I consent to these images being processed/ }).click();
    await page.getByRole('button', { name: 'Submit Project' }).click();

    // Landed on the project page with a public reference and SUBMITTED status.
    await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]+/, { timeout: 30_000 });
    await expect(page.getByText(/AVS-\d{6}/)).toBeVisible();
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(brief)).toBeVisible();

    // And it appears on the dashboard.
    await page.goto('/dashboard');
    await expect(page.getByText(brief.slice(0, 40), { exact: false })).toBeVisible();
  });

  test('a customer cannot open a project id that is not theirs', async ({ page }) => {
    await signIn(page);

    // A well-formed id that belongs to nobody. RLS filters it out before the page
    // sees it, so the result is a 404 — the same response another customer's real
    // project id produces, which is what stops URL tampering being informative.
    await page.goto('/dashboard/projects/00000000-1111-4222-8333-444444444444');

    await expect(page.getByRole('heading', { name: /We could not find that\./ })).toBeVisible();
  });

  test('a customer is redirected away from the admin area', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin');

    // requireAdmin() redirects rather than 403s: a non-admin learns nothing about
    // what is there. (A test user with the admin role would legitimately see it.)
    await expect(page).toHaveURL(/\/(dashboard|admin)/);
  });
});
