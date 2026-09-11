import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

/**
 * The public surface. These specs need no Supabase credentials — the marketing
 * pages fall back to the typed catalogue when the database is unreachable.
 */

test('the homepage loads with its hero, message and both calls to action', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your photos.');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your movie.');
  await expect(
    page.getByText('Turn existing photographs into bespoke cinematic AI-generated video'),
  ).toBeVisible();

  await expect(page.getByRole('link', { name: 'Create My Video' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Portfolio' })).toBeVisible();
});

test('a visitor can reach Create My Video from the homepage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create My Video' }).first().click();

  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('heading', { name: /Let’s build your film\./ })).toBeVisible();
  // Step 1 is public: choosing an experience needs no account.
  await expect(
    page.getByRole('heading', { name: /What kind of film are we making\?/ }),
  ).toBeVisible();
});

test('the portfolio lists work and filters by category', async ({ page }) => {
  await page.goto('/portfolio');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Create Your Version/ }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Fashion', exact: true }).click();
  await expect(page).toHaveURL(/category=FASHION/);
  await expect(page.getByRole('link', { name: 'Fashion', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
});

test('"Create Your Version" carries the experience into the create flow', async ({ page }) => {
  await page.goto('/portfolio');
  await page
    .getByRole('link', { name: /Create Your Version/ })
    .first()
    .click();

  await expect(page).toHaveURL(/\/create\?experience=/);
});

test('how it works and pricing are reachable, and pricing is marked provisional', async ({
  page,
}) => {
  await page.goto('/how-it-works');
  await expect(page.getByRole('heading', { name: 'Choose your experience' })).toBeVisible();

  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Starter' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cinematic' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Premium' })).toBeVisible();
  // Placeholder pricing must never read as a commercial offer.
  await expect(page.getByText('Provisional pricing')).toBeVisible();
});

test('the homepage works at phone width without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
});
