import { expect, test, type Page } from '@playwright/test';

/**
 * The brief must survive the sign-up detour.
 *
 * A visitor writes their whole brief before they have an account. If the
 * Supabase project has email confirmation enabled, the journey continues:
 *
 *     /create -> /signup -> [email] -> /auth/confirm?next=/create -> /create
 *                              ^
 *                  opened from a mail client, in a NEW TAB
 *
 * These specs reproduce that with a second browser tab sharing the same context,
 * which is exactly what a mail-client link does. They need no Supabase
 * credentials: the auth gate is what an unauthenticated visitor sees anyway.
 */

const BRIEF =
  'I want to walk through a luxury yacht in Monaco wearing an elegant summer outfit. The mood should feel confident, sophisticated and cinematic.';

async function fillBriefUpToAuthGate(page: Page) {
  await page.goto('/create');

  await page.getByText('Luxury Lifestyle', { exact: true }).first().click();
  await page.getByRole('button', { name: /Continue to your brief/ }).click();

  await page.getByLabel('Your brief').fill(BRIEF);
  await page.getByLabel('Mood').fill('Confident and warm');
  await page.getByLabel('Location or environment').fill('Monaco harbour, sunset');
  await page.getByText('Vertical 9:16').click();
  await page.getByText('30 seconds').click();
  await page.getByRole('button', { name: /Continue to reference images/ }).click();

  // An unauthenticated visitor is prompted to sign up at exactly this point.
  await expect(page.getByRole('heading', { name: /Create an account to continue/ })).toBeVisible();
}

test('an unauthenticated visitor is prompted to sign up only once images are needed', async ({
  page,
}) => {
  await fillBriefUpToAuthGate(page);

  await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();
  await expect(page.getByRole('link', { name: /I already have an account/ })).toBeVisible();
  // The promise made to the customer at the gate.
  await expect(page.getByText(/Your brief has been kept/)).toBeVisible();
});

test('the brief survives being reopened in a NEW TAB, as a mail-client link does', async ({
  context,
  page,
}) => {
  await fillBriefUpToAuthGate(page);

  // A confirmation link opens a fresh tab in the same browser. sessionStorage
  // would be empty here; localStorage is not.
  const newTab = await context.newPage();
  await newTab.goto('/create');

  // Restored straight back to the upload step, brief intact.
  await expect(
    newTab.getByRole('heading', { name: /Create an account to continue/ }),
  ).toBeVisible();

  await newTab.getByRole('button', { name: 'Back to your brief' }).click();
  await expect(newTab.getByLabel('Your brief')).toHaveValue(BRIEF);
  await expect(newTab.getByLabel('Mood')).toHaveValue('Confident and warm');
  await expect(newTab.getByLabel('Location or environment')).toHaveValue('Monaco harbour, sunset');

  await newTab.close();
});

test('the brief survives the round trip through /signup and back', async ({ page }) => {
  await fillBriefUpToAuthGate(page);

  await page.getByRole('link', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fcreate/);

  // Returning to /create — the same navigation /auth/confirm performs.
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: /Create an account to continue/ })).toBeVisible();

  await page.getByRole('button', { name: 'Back to your brief' }).click();
  await expect(page.getByLabel('Your brief')).toHaveValue(BRIEF);
});

test('the brief is held in localStorage, not sessionStorage', async ({ page }) => {
  await fillBriefUpToAuthGate(page);

  const stored = await page.evaluate(() => ({
    local: window.localStorage.getItem('avs:create-draft'),
    session: window.sessionStorage.getItem('avs:create-draft'),
    legacy: window.sessionStorage.getItem('avs:create-draft:v1'),
  }));

  expect(stored.local, 'the brief must be in localStorage to survive a new tab').not.toBeNull();
  expect(stored.session).toBeNull();
  expect(stored.legacy).toBeNull();

  // Only the customer's own answers — no identifiers, tokens or image data.
  expect(stored.local).not.toMatch(/token|access|jwt|user_id|data:image/i);
});

test('a visitor can go back and change the experience without losing the brief', async ({
  page,
}) => {
  await fillBriefUpToAuthGate(page);

  await page.getByRole('button', { name: 'Back to your brief' }).click();
  await page.getByRole('button', { name: 'Back' }).click();

  await expect(
    page.getByRole('heading', { name: /What kind of film are we making\?/ }),
  ).toBeVisible();
  await page.getByText('Fashion', { exact: true }).first().click();
  await page.getByRole('button', { name: /Continue to your brief/ }).click();

  await expect(page.getByLabel('Your brief')).toHaveValue(BRIEF);
});
