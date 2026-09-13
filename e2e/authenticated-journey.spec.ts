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

    // And it appears on the dashboard. Each project is a link whose accessible
    // name contains its reference; getByText would also match every ancestor
    // that merely contains it.
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: new RegExp(reference) })).toBeVisible();
  });

  test('a project cannot be submitted without both required consents', async ({ page }) => {
    await signIn(page, CUSTOMER_A, '/create');
    await page.goto('/create');

    await page.getByText('Luxury Lifestyle', { exact: true }).first().click();
    await page.getByRole('button', { name: /Continue to your vision/ }).click();
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

    await expect(page.getByRole('heading', { name: /Check it over/ })).toBeVisible();

    // The consent controls sit in a <fieldset> whose sr-only <legend> is
    // "Consent", so this is role="group" named "Consent". Scoping to it targets
    // the validation alert rather than Next's role="alert" route announcer.
    const consent = page.getByRole('group', { name: 'Consent' });
    const consentAlert = consent.getByRole('alert');

    // Nothing ticked: refused, and no navigation.
    await page.getByRole('button', { name: 'Submit Project' }).click();
    await expect(consentAlert).toContainText(/required confirmations/i);
    await expect(page).toHaveURL(/\/create/);

    // One of the two is still not enough: still refused, still on /create.
    await page.getByRole('checkbox', { name: /I confirm that I am the person shown/ }).click();
    await page.getByRole('button', { name: 'Submit Project' }).click();
    await expect(page).toHaveURL(/\/create/);
    await expect(page.getByRole('heading', { name: /Check it over/ })).toBeVisible();

    // This spec deliberately stops here rather than ticking the second box and
    // submitting. The positive case — both consents given, submission succeeds —
    // is already covered by "briefs, uploads, consents, submits" above, and
    // submitting again would leave a second persistent project behind on every
    // run of a suite that shares one live project.
    //
    // The draft this spec leaves is reclaimed by the next run: /create resumes
    // the most recent draft rather than starting another.
    await expect(
      page.getByRole('checkbox', { name: /I consent to these images being processed/ }),
    ).not.toBeChecked();
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
    await expect(page.getByRole('link', { name: new RegExp(reference) })).toBeVisible();
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
    // Nothing of A's project may appear anywhere on the page B is served.
    await expect(page.getByText(brief)).toHaveCount(0);
    await expect(page.getByText(reference)).toHaveCount(0);
  });

  test('every project on B’s dashboard is one B can actually open', async ({ page }) => {
    await signIn(page, CUSTOMER_B);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Welcome back/);

    const projectLinks = page.getByRole('link', { name: /AVS-\d{6}/ });
    const count = await projectLinks.count();

    if (count === 0) {
      // An empty dashboard is a valid state, but it must be the empty state —
      // not a silent pass because the list failed to render.
      await expect(page.getByText(/No projects yet/)).toBeVisible();
      return;
    }

    // A project RLS hides never reaches this list in the first place. Opening
    // one proves the list and the detail page agree on what B owns: if the
    // dashboard ever leaked another customer's project, this would 404.
    await projectLinks.first().click();
    await expect(page).toHaveURL(/\/dashboard\/projects\/[0-9a-f-]+/);
    await expect(page.getByRole('heading', { name: /We could not find that\./ })).toHaveCount(0);
    await expect(page.getByText(/^AVS-\d{6}$/)).toBeVisible();
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
    await signIn(page, ADMIN);
    await page.goto('/admin');

    // Reuse a project already awaiting review rather than submitting a new one.
    //
    // This suite runs against one shared live project, and Playwright retries
    // failed tests in CI. When this spec created its own project, a failure in
    // the assertions below meant each retry submitted another — which is how a
    // single failing run left AVS-000006, -000007 and -000008 behind. Reusing
    // the queue makes the spec idempotent: retries act on the same row, and
    // repeat runs stop accumulating rows at all.
    //
    // Filtering on a `cell` named exactly "Submitted" deliberately excludes the
    // header row, whose "Submitted" is a `columnheader` for the date column.
    const submittedRows = page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'Submitted', exact: true }) });

    if ((await submittedRows.count()) === 0) {
      // Nothing in the queue — seed exactly one. Only happens on a fresh
      // project, or when this spec is run in isolation.
      test.skip(!hasCustomerA, SKIP_CUSTOMER_A);

      const contextA = await browser.newContext();
      const pageA = await contextA.newPage();
      await signIn(pageA, CUSTOMER_A, '/create');
      await createAndSubmitProject(
        pageA,
        `Admin queue seed ${Date.now()}: a composed founder portrait in motion, restrained and boardroom-ready.`,
      );
      await contextA.close();

      await page.reload();
      await expect(submittedRows.first()).toBeVisible({ timeout: 20_000 });
    }

    const row = submittedRows.first();
    await expect(row).toBeVisible();

    // The reference appears twice in a row: the visible cell, and the sr-only
    // text inside the "Open" link. Reading it from the anchored cell is
    // unambiguous — and the sr-only text stays exactly where it is, because it
    // is what makes that link usable by a screen reader.
    const reference = ((await row.getByText(/^AVS-\d{6}$/).textContent()) ?? '').trim();
    expect(reference).toMatch(/^AVS-\d{6}$/);

    await row.getByRole('link', { name: /Open/ }).click();

    await expect(page).toHaveURL(/\/admin\/projects\/[0-9a-f-]+/);
    await expect(page.getByText(reference)).toBeVisible();

    // SUBMITTED -> ASSETS_REVIEW is permitted by the workflow.
    await page.getByRole('button', { name: /Move to Assets in review/ }).click();

    // The history the database trigger wrote, on the page, after the move.
    await expect(page.getByText('SUBMITTED → ASSETS_REVIEW')).toBeVisible({ timeout: 20_000 });

    // A transition that skips production is not offered at all.
    await expect(page.getByRole('button', { name: /Move to Completed/ })).toHaveCount(0);
  });
});
