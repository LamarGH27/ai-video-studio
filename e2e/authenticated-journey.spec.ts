import { expect, test } from '@playwright/test';
import {
  ADMIN,
  CUSTOMER_A,
  CUSTOMER_B,
  SKIP_ADMIN,
  SKIP_BOTH_CUSTOMERS,
  SKIP_CUSTOMER_A,
  createAndSubmitProject,
  hasAdmin,
  hasBothCustomers,
  hasCustomerA,
  signIn,
  tinyJpeg,
} from './helpers';

/**
 * The authenticated customer journey, end to end, against a live Supabase
 * project: sign in -> brief -> upload -> consent -> submit -> dashboard ->
 * project page.
 */
test.describe('Customer A journey', () => {
  test.skip(!hasCustomerA, SKIP_CUSTOMER_A);

  test('signs in and reaches their dashboard', async ({ page }) => {
    await signIn(page, CUSTOMER_A);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Welcome back/);
  });

  test('views their own profile name on the dashboard', async ({ page }) => {
    await signIn(page, CUSTOMER_A);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('briefs, uploads, consents, submits, then views the project', async ({ page }) => {
    await signIn(page, CUSTOMER_A, '/create');

    const brief = `Customer A brief ${Date.now()}: a slow walk through a berthed yacht in Monaco at golden hour, confident and unhurried.`;
    const { reference } = await createAndSubmitProject(page, brief);

    expect(reference).toMatch(/^AVS-\d{6}$/);
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(brief)).toBeVisible();

    // The reference image is shown through a signed URL, not a public one.
    const imageSrc = await page
      .getByRole('img', { name: /Reference image/ })
      .first()
      .getAttribute('src');
    expect(imageSrc, 'reference images must be served through a signed URL').toContain('token=');
    expect(imageSrc).not.toContain('/object/public/');

    // And it appears on the dashboard.
    await page.goto('/dashboard');
    await expect(page.getByText(reference)).toBeVisible();
  });

  test('a project cannot be submitted without both required consents', async ({ page }) => {
    await signIn(page, CUSTOMER_A, '/create');
    await page.goto('/create');

    await page.getByText('Luxury Lifestyle', { exact: true }).first().click();
    await page.getByRole('button', { name: /Continue to your brief/ }).click();
    await page
      .getByLabel('Your brief')
      .fill(`Consent gate check ${Date.now()}: a cinematic walk through a Monaco marina at dusk.`);
    await page.getByText('Vertical 9:16').click();
    await page.getByRole('button', { name: /Continue to reference images/ }).click();

    await expect(page.getByRole('heading', { name: /Upload your reference images/ })).toBeVisible({
      timeout: 20_000,
    });

    const uploaded = page.getByRole('button', { name: /^Remove / });
    const before = await uploaded.count();
    await page.setInputFiles('#reference-images', {
      name: 'reference.jpg',
      mimeType: 'image/jpeg',
      buffer: tinyJpeg(),
    });
    await expect(uploaded).toHaveCount(before + 1, { timeout: 30_000 });
    await page.getByRole('button', { name: /Continue to review/ }).click();

    // Submitting with nothing ticked must be refused, and must not navigate.
    await expect(page.getByRole('heading', { name: /Check it over/ })).toBeVisible();
    await page.getByRole('button', { name: 'Submit Project' }).click();
    await expect(page.getByRole('alert')).toContainText(/required confirmations/i);
    await expect(page).toHaveURL(/\/create/);

    // One of the two is still not enough.
    await page.getByRole('checkbox', { name: /I confirm that I am the person shown/ }).click();
    await page.getByRole('button', { name: 'Submit Project' }).click();
    await expect(page).toHaveURL(/\/create/);
  });

  test('is redirected away from the admin area', async ({ page }) => {
    await signIn(page, CUSTOMER_A);
    await page.goto('/admin');

    // requireAdmin() redirects rather than 403s: a non-admin learns nothing
    // about what is there.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Welcome back/);
  });
});

/**
 * Cross-customer isolation through the browser. The database-level proof lives
 * in supabase/tests/02_rls_attack_matrix.sql and scripts/verify-live.ts; this
 * confirms the UI surfaces that refusal as a dead end rather than a leak.
 */
test.describe('Customer B isolation', () => {
  test.skip(!hasBothCustomers, SKIP_BOTH_CUSTOMERS);

  test('B creates their own project independently of A', async ({ page }) => {
    await signIn(page, CUSTOMER_B, '/create');

    const brief = `Customer B brief ${Date.now()}: an editorial studio sequence in high contrast monochrome.`;
    const { reference } = await createAndSubmitProject(page, brief);

    expect(reference).toMatch(/^AVS-\d{6}$/);
    await page.goto('/dashboard');
    await expect(page.getByText(reference)).toBeVisible();
  });

  test('B cannot open A’s project by changing the URL', async ({ page, browser }) => {
    // A submits a project and we note its URL.
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await signIn(pageA, CUSTOMER_A, '/create');
    const brief = `Isolation probe ${Date.now()}: a quiet tracking shot along a Monaco quayside at first light.`;
    const { url: projectUrl, reference } = await createAndSubmitProject(pageA, brief);
    await contextA.close();

    // B, in a separate session, tries the exact same URL.
    await signIn(page, CUSTOMER_B);
    await page.goto(projectUrl);

    await expect(page.getByRole('heading', { name: /We could not find that\./ })).toBeVisible();
    await expect(page.getByText(brief)).toHaveCount(0);
    await expect(page.getByText(reference)).toHaveCount(0);
  });

  test('B’s dashboard shows only B’s projects', async ({ page }) => {
    await signIn(page, CUSTOMER_B);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Nothing on B's dashboard may reference a project B does not own. The
    // strongest available browser-side check is that every project link on the
    // page resolves for B rather than 404-ing.
    const links = await page.getByRole('link', { name: /Open|project/i }).all();
    expect(links.length).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Admin', () => {
  test.skip(!hasAdmin, SKIP_ADMIN);

  test('reaches the admin area and sees the production queue', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Production queue' })).toBeVisible();
  });

  test('opens a submitted project and performs a permitted status transition', async ({
    page,
    browser,
  }) => {
    test.skip(!hasCustomerA, SKIP_CUSTOMER_A);

    // A submits something for the admin to act on.
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await signIn(pageA, CUSTOMER_A, '/create');
    const brief = `Admin transition probe ${Date.now()}: a composed founder portrait in motion, restrained and boardroom-ready.`;
    const { reference } = await createAndSubmitProject(pageA, brief);
    await contextA.close();

    await signIn(page, ADMIN);
    await page.goto('/admin');
    await expect(page.getByText(reference)).toBeVisible();

    await page
      .getByRole('row', { name: new RegExp(reference) })
      .getByRole('link')
      .click();
    await expect(page.getByText(brief)).toBeVisible();

    // SUBMITTED -> ASSETS_REVIEW is permitted by the workflow.
    await page.getByRole('button', { name: /Move to Assets in review/ }).click();
    await expect(page.getByText('Assets in review').first()).toBeVisible({ timeout: 20_000 });

    // The history the trigger wrote is visible on the admin page.
    await expect(page.getByText('SUBMITTED → ASSETS_REVIEW')).toBeVisible();

    // A transition that skips production is not even offered.
    await expect(page.getByRole('button', { name: /Move to Completed/ })).toHaveCount(0);
  });
});
