import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  CUSTOMER_A,
  CUSTOMER_B,
  SKIP_ADMIN_AND_BOTH_CUSTOMERS,
  createAndSubmitProject,
  hasAdmin,
  hasBothCustomers,
  signIn,
  tinyMp4,
} from './helpers';

/**
 * The whole delivery lifecycle, driven through the browser against a live
 * Supabase project:
 *
 *   admin: submitted -> asset review -> production -> upload preview
 *   customer A: sees preview 1, requests a revision
 *   admin: sees the revision, reworks, uploads preview 2
 *   customer A: approves preview 2  -> FINALISING
 *   admin: uploads the final, completes the project
 *   customer A: sees the final and can obtain an authorised download
 *   customer B: can reach none of it
 *
 * One test, not eight, on purpose. Each step depends on the state the previous
 * one produced, and splitting them would either mean eight projects per run or
 * eight tests silently coupled through shared state. As one linear test it is
 * repeatable, and a failure names the exact stage that broke.
 */
test.describe('delivery lifecycle', () => {
  test.skip(!(hasAdmin && hasBothCustomers), SKIP_ADMIN_AND_BOTH_CUSTOMERS);

  // The longest test in the suite: two uploads and eight status transitions,
  // each a real round trip to Supabase.
  test.setTimeout(180_000);

  async function openAdminProject(page: Page, reference: string) {
    await page.goto('/admin');
    const row = page.getByRole('row').filter({ hasText: reference });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('link', { name: /Open/ }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/[0-9a-f-]+/);
  }

  /**
   * Selects a file for the admin uploader. It does NOT wait for completion —
   * the upload button keeps its place throughout, so waiting on it would return
   * immediately and prove nothing. Each caller waits on the real consequence
   * instead (the status changing, or the new delivery appearing).
   */
  async function chooseDeliveryFile(page: Page) {
    await page.setInputFiles('input[type="file"]', {
      name: 'delivery.mp4',
      mimeType: 'video/mp4',
      buffer: tinyMp4(),
    });
  }

  test('preview, revision, approval, final delivery and download', async ({ page, browser }) => {
    // ---------------------------------------------------------------- set-up
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await signIn(pageA, CUSTOMER_A, '/create');

    const brief = `Delivery lifecycle ${Date.now()}: a slow walk along a Monaco quayside at first light, unhurried and composed.`;
    const { url: projectUrl, reference } = await createAndSubmitProject(pageA, brief);
    expect(reference).toMatch(/^AVS-\d{6}$/);

    // ------------------------------------------------- admin: into production
    await signIn(page, ADMIN);
    await openAdminProject(page, reference);

    await expect(page.getByRole('heading', { name: 'Next production action' })).toBeVisible();
    await expect(page.getByText('Start Asset Review')).toBeVisible();

    await page.getByRole('button', { name: /Move to Assets in review/ }).click();
    await expect(page.getByText('Begin Production')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /Move to In production/ }).click();
    await expect(page.getByText('Upload Preview')).toBeVisible({ timeout: 20_000 });

    // ------------------------------------------------- admin: upload preview 1
    await chooseDeliveryFile(page);
    // Uploading a preview is what moves the project to Preview ready.
    await expect(page.getByText('Waiting for customer')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Preview 1')).toBeVisible();

    // ------------------------------------------- customer A: request a revision
    await pageA.goto(projectUrl);
    await expect(pageA.getByRole('heading', { name: /Preview 1/ })).toBeVisible();
    await expect(pageA.locator('video')).toBeVisible();

    // The preview is served through the authorising route, never as a raw
    // signed URL embedded in the page.
    const previewSrc = await pageA.locator('video source').first().getAttribute('src');
    expect(previewSrc).toMatch(/^\/api\/deliveries\/[0-9a-f-]+$/);

    await pageA.getByRole('button', { name: 'Request Revision' }).click();

    // Too short is refused, by the schema and by the database behind it.
    await pageA.getByLabel(/What would you like changed/).fill('too short');
    await pageA.getByRole('button', { name: /Send revision request/ }).click();
    await expect(
      pageA.getByRole('alert').filter({ hasText: /at least 20 characters/i }),
    ).toBeVisible();

    const revisionMessage =
      'The walk along the deck is a little quick — please hold a beat longer at the railing before the camera moves on.';
    await pageA.getByLabel(/What would you like changed/).fill(revisionMessage);
    await pageA.getByRole('button', { name: /Send revision request/ }).click();

    await expect(pageA.getByText(revisionMessage)).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByText('Your changes are with the team.')).toBeVisible();
    // The decision controls are gone now that the ball is not in their court.
    await expect(pageA.getByRole('button', { name: 'Approve Preview' })).toHaveCount(0);

    // ------------------------------------------------- admin: rework and re-deliver
    await page.reload();
    await expect(page.getByText('The customer has requested changes')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(revisionMessage)).toBeVisible();
    await expect(page.getByText('Begin Revision')).toBeVisible();

    await page.getByRole('button', { name: /Move to In production/ }).click();
    await expect(page.getByText('Upload Preview')).toBeVisible({ timeout: 20_000 });

    await chooseDeliveryFile(page);
    await expect(page.getByText('Waiting for customer')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Preview 2')).toBeVisible();
    // Preview 1 is kept: a new preview is a new object, never an overwrite.
    await expect(page.getByText('Preview 1')).toBeVisible();

    // ------------------------------------------------- customer A: approve
    await pageA.goto(projectUrl);
    await expect(pageA.getByRole('heading', { name: /Preview 2/ })).toBeVisible({
      timeout: 20_000,
    });
    await pageA.getByRole('button', { name: 'Approve Preview' }).click();

    await expect(pageA.getByRole('heading', { name: /Finalising your video/ })).toBeVisible({
      timeout: 30_000,
    });
    // Approval is final: neither decision is offered again.
    await expect(pageA.getByRole('button', { name: 'Approve Preview' })).toHaveCount(0);
    await expect(pageA.getByRole('button', { name: 'Request Revision' })).toHaveCount(0);

    // ------------------------------------------------- admin: final delivery
    await page.reload();
    await expect(page.getByText('Upload Final Video')).toBeVisible({ timeout: 20_000 });

    await chooseDeliveryFile(page);
    // The final does NOT auto-complete: the admin confirms completion.
    await expect(page.getByRole('button', { name: /Move to Completed/ })).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole('button', { name: /Move to Completed/ }).click();
    await expect(page.getByText(/Delivered\. Nothing further is required\./)).toBeVisible({
      timeout: 30_000,
    });

    // ------------------------------------------------- customer A: the film
    await pageA.goto(projectUrl);
    await expect(pageA.getByRole('heading', { name: /Your film is ready/ })).toBeVisible({
      timeout: 20_000,
    });

    const downloadLink = pageA.getByRole('link', { name: /Download Final Video/ });
    await expect(downloadLink).toBeVisible();
    await expect(downloadLink).toHaveAttribute(
      'href',
      /^\/api\/deliveries\/[0-9a-f-]+\?download=1$/,
    );

    // The download must actually produce authorised access, not a 404 or a
    // publicly reachable object.
    const href = (await downloadLink.getAttribute('href')) ?? '';
    const download = await pageA.request.get(href, { maxRedirects: 0 });
    expect(download.status(), 'the download route must redirect to a signed URL').toBe(302);
    const signed = download.headers()['location'] ?? '';
    expect(signed).toContain('token=');
    expect(signed).not.toContain('/object/public/');
    expect(download.headers()['cache-control']).toContain('no-store');

    // The whole journey is on the record.
    await expect(pageA.getByText(revisionMessage)).toBeVisible();

    // ------------------------------------------------- customer B: nothing
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await signIn(pageB, CUSTOMER_B);

    await pageB.goto(projectUrl);
    await expect(pageB.getByRole('heading', { name: /We could not find that\./ })).toBeVisible();
    await expect(pageB.getByText(revisionMessage)).toHaveCount(0);

    // And not the media either, by its own id.
    const assetId = (previewSrc ?? '').split('/').pop() ?? '';
    expect(assetId).not.toBe('');
    const stolen = await pageB.request.get(`/api/deliveries/${assetId}`, { maxRedirects: 0 });
    expect(stolen.status(), 'another customer must not reach delivery media').toBe(404);

    const stolenDownload = await pageB.request.get(`/api/deliveries/${assetId}?download=1`, {
      maxRedirects: 0,
    });
    expect(stolenDownload.status()).toBe(404);

    await contextB.close();
    await contextA.close();
  });

  test('delivery media is refused to an unauthenticated visitor', async ({ page }) => {
    // A well-formed id that belongs to nobody: the same 404 a real id gets for
    // the wrong caller, so the route cannot be used to probe for assets.
    const response = await page.request.get(
      '/api/deliveries/00000000-1111-4222-8333-444444444444',
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toContain('no-store');
  });
});
