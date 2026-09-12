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
   * The admin page states the next action twice by design: once as the panel's
   * heading, and again as the label on the control that performs it. Both are
   * correct — the heading tells you what stage you are at, the button does it —
   * so the test has to say which one it means rather than the markup being
   * changed to suit it.
   *
   * Every admin assertion below is therefore anchored to the region it belongs
   * to. The regions are the page's own landmarks (`<section>` with an
   * accessible name), so this is reading the page the way a screen reader does,
   * not adding hooks for the test.
   */
  const nextAction = (page: Page) => page.getByRole('region', { name: 'Next production action' });
  const previewList = (page: Page) => page.getByRole('region', { name: 'Previews' });
  const finalList = (page: Page) => page.getByRole('region', { name: 'Finals' });

  /**
   * The panel's heading — what stage the project is at.
   *
   * Restricted to the panel's prose rather than anything in the region, because
   * the region deliberately contains both: for a stage whose action is an
   * upload, `getByText` inside it would still match the heading AND the button.
   * Narrowing to <p> separates the sentence from the control, so this helper
   * cannot become ambiguous when a future stage gains a button of the same name.
   */
  const stage = (page: Page, label: string) =>
    nextAction(page).locator('p').filter({ hasText: label });

  /** The control that performs it. */
  const actionButton = (page: Page, label: string) =>
    nextAction(page).getByRole('button', { name: label });

  /**
   * Selects a file for the admin uploader. It does NOT wait for completion —
   * the upload button keeps its place throughout, so waiting on it would return
   * immediately and prove nothing. Each caller waits on the real consequence
   * instead (the status changing, or the new delivery appearing).
   */
  async function chooseDeliveryFile(page: Page) {
    await nextAction(page).locator('input[type="file"]').setInputFiles({
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
    await expect(stage(page, 'Start Asset Review')).toBeVisible();

    await page.getByRole('button', { name: /Move to Assets in review/ }).click();
    await expect(stage(page, 'Begin Production')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /Move to In production/ }).click();
    // The button, not the heading: readiness means the control is there to use.
    await expect(actionButton(page, 'Upload Preview')).toBeVisible({ timeout: 20_000 });

    // ------------------------------------------------- admin: upload preview 1
    await chooseDeliveryFile(page);
    // Uploading a preview is what moves the project to Preview ready.
    await expect(stage(page, 'Waiting for customer')).toBeVisible({ timeout: 90_000 });
    await expect(previewList(page).getByText('Preview 1')).toBeVisible();

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

    const customerRevisions = pageA.getByRole('region', { name: 'Changes you have requested' });
    await expect(customerRevisions.getByText(revisionMessage)).toBeVisible({ timeout: 30_000 });
    await expect(
      pageA.getByRole('heading', { name: 'Your changes are with the team.' }),
    ).toBeVisible();
    // The decision controls are gone now that the ball is not in their court.
    await expect(pageA.getByRole('button', { name: 'Approve Preview' })).toHaveCount(0);

    // ------------------------------------------------- admin: rework and re-deliver
    await page.reload();
    // The request appears twice on this page — as the alert that demands
    // attention, and again in the permanent history below. Assert on the alert,
    // and that the message is inside it rather than merely somewhere on the
    // page: "the admin was told" is the thing being tested.
    const revisionAlert = page
      .getByRole('alert')
      .filter({ hasText: 'The customer has requested changes' });
    await expect(revisionAlert).toBeVisible({ timeout: 20_000 });
    await expect(revisionAlert).toContainText(revisionMessage);
    await expect(stage(page, 'Begin Revision')).toBeVisible();

    await page.getByRole('button', { name: /Move to In production/ }).click();
    await expect(actionButton(page, 'Upload Preview')).toBeVisible({ timeout: 20_000 });

    await chooseDeliveryFile(page);
    await expect(stage(page, 'Waiting for customer')).toBeVisible({ timeout: 90_000 });
    await expect(previewList(page).getByText('Preview 2')).toBeVisible();
    // Preview 1 is kept: a new preview is a new object, never an overwrite.
    await expect(previewList(page).getByText('Preview 1')).toBeVisible();

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
    await expect(actionButton(page, 'Upload Final Video')).toBeVisible({ timeout: 20_000 });

    // Nothing has been delivered yet, so completion is not on offer. The
    // database would refuse it, and a button that can only fail is worse than
    // no button — the admin would find out only after clicking.
    await expect(page.getByRole('button', { name: /Move to Completed/ })).toHaveCount(0);

    await chooseDeliveryFile(page);

    // Wait on the delivery appearing, NOT on the Move to Completed button.
    // Uploading a final changes no status — by design, completion stays an
    // explicit decision — so unlike the preview step there is no status change
    // to wait for, and the button is the wrong thing to wait on in any case:
    // clicking it before the upload lands asks the database to complete a
    // project with nothing to deliver, which it refuses.
    await expect(finalList(page).getByText('Final 1')).toBeVisible({ timeout: 90_000 });

    // Only now is the transition actually available. It is offered *because*
    // the final exists — see allowedAdminTransitions() — so this assertion is
    // also what proves the control is not offered prematurely.
    const completeButton = page.getByRole('button', { name: /Move to Completed/ });
    await expect(completeButton).toBeVisible();
    await completeButton.click();
    await expect(
      nextAction(page).getByText(/Delivered\. Nothing further is required\./),
    ).toBeVisible({ timeout: 30_000 });

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
    await expect(
      pageA.getByRole('region', { name: 'Changes you have requested' }).getByText(revisionMessage),
    ).toBeVisible();

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
