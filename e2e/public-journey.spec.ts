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
    page.getByText('Upload your photos, describe the experience you want to live'),
  ).toBeVisible();

  await expect(page.getByRole('link', { name: 'Create My Video' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /See What.s Possible/ })).toBeVisible();
});

test('a visitor can reach Create My Video from the homepage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create My Video' }).first().click();

  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('heading', { name: /Let’s build your film\./ })).toBeVisible();
  // The nav CTA and the hero CTA share a name; .first() is the hero.
  // Step 1 is public: choosing an experience needs no account.
  await expect(
    page.getByRole('heading', { name: /What kind of film are we making\?/ }),
  ).toBeVisible();
});

test('the portfolio lists work and filters by category', async ({ page }) => {
  await page.goto('/portfolio');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Imagine your version');
  await expect(page.getByRole('link', { name: /Create Your Version/ }).first()).toBeVisible();

  // Credibility: nothing here has been delivered to a customer, so every piece
  // is marked, and the page says so once in plain words.
  await expect(page.getByText(/concept we created to show a direction/)).toBeVisible();
  expect(await page.getByText('Concept', { exact: true }).count()).toBeGreaterThan(0);

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
  await expect(page.getByRole('heading', { name: 'Choose your idea' })).toBeVisible();

  // The workflow shipped in Milestone 2A; nothing here may still say otherwise.
  await expect(page.getByText('Coming soon')).toHaveCount(0);

  // Pricing is still reachable directly — it is only out of public discovery.
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

/**
 * The redesign leans on large display type and full-bleed media, both of which
 * are ways to introduce horizontal overflow. Every public page is checked at the
 * narrowest width we support rather than only the homepage.
 */
for (const [name, path] of [
  ['the portfolio', '/portfolio'],
  ['how it works', '/how-it-works'],
  ['the create flow', '/create'],
] as const) {
  test(`${name} has no sideways scrolling at 375px`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    await expectNoHorizontalScroll(page);
  });
}

/**
 * Credibility rules that are easy to undo by accident with one word of copy.
 */
test('the public site never claims a customer history it does not have', async ({ page }) => {
  for (const path of ['/', '/portfolio', '/how-it-works'] as const) {
    await page.goto(path);
    const body = (await page.locator('body').textContent()) ?? '';

    for (const claim of [
      'Films we have made',
      'producer assigned to your project',
      'Only you can open your project',
      'none can be created',
    ]) {
      expect(body, `${path} still says "${claim}"`).not.toContain(claim);
    }
  }
});

test('pricing is not promoted in public navigation or the footer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByText('Pricing')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Explore' }).getByText('Pricing')).toHaveCount(
    0,
  );
});

/**
 * Real media.
 *
 * One caveat worth stating plainly: the Chromium that Playwright ships has no
 * H.264 decoder, so `play()` always rejects here and no assertion below can
 * prove that the flagship film visibly plays in a real browser. What they do
 * prove is everything around it — that nothing is fetched on load, that the
 * gallery starts no playback at all, that the flagship is muted before any
 * attempt is made, and that asking for reduced motion stops the attempt from
 * happening. Those are the properties that break silently; playback itself
 * fails loudly.
 */
test('no film is downloaded, and none plays, until somebody asks', async ({ page }) => {
  await page.goto('/portfolio');

  const videos = page.locator('video');
  const count = await videos.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const video = videos.nth(index);
    const state = await video.evaluate((element: HTMLVideoElement) => ({
      paused: element.paused,
      preload: element.preload,
      poster: element.poster,
      controls: element.controls,
      label: element.getAttribute('aria-label'),
    }));

    expect(state.paused, `gallery video ${index} autoplayed`).toBe(true);
    expect(state.preload, `gallery video ${index} preloads`).toBe('none');
    expect(state.poster, `gallery video ${index} has no poster`).toMatch(/\.(webp|jpg|png)$/);
    expect(state.controls, `gallery video ${index} hides its controls`).toBe(true);
    expect(state.label, `gallery video ${index} has no accessible name`).toBeTruthy();
  }
});

test('the gallery leads with all nine films, before any placeholder', async ({ page }) => {
  await page.goto('/portfolio');

  const headings = await page.locator('h2').allTextContents();
  expect(headings.slice(0, 9)).toEqual([
    'Midnight Yacht',
    'Golden Hour',
    'After Hours',
    'Golden Coast',
    'Executive Presence',
    'Atelier Day',
    'Island Arrival',
    'Garden Wedding',
    'The Suite',
  ]);

  // Nine players, and every one of them is a film we hold.
  await expect(page.locator('video')).toHaveCount(9);

  // Every piece on the page carries the mark; none is presented as a commission.
  const marks = await page.getByText('Concept', { exact: true }).count();
  expect(marks).toBeGreaterThanOrEqual(9);
  const body = (await page.locator('body').textContent()) ?? '';
  for (const word of ['Commission', 'Client work', 'Case study']) {
    expect(body, `the gallery says "${word}"`).not.toContain(word);
  }
});

/**
 * The homepage carries five film stills and exactly one player. Posters are
 * images; only the transformation result is a <video>, and only it may autoplay.
 */
test('the homepage shows the range with one player, not nine', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('video')).toHaveCount(1);

  const posters = await page
    .locator('img[src^="/showcase/"]')
    .evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).getAttribute('src')),
    );

  // The flagship still, the four strip films, and the one input image the
  // transformation needs. The homepage argues range, not completeness, and two
  // of its four strip cards are led by somebody other than the man in most of
  // the library.
  expect(new Set(posters)).toEqual(
    new Set([
      '/showcase/midnight-yacht-poster.webp',
      '/showcase/midnight-yacht-reference.webp',
      '/showcase/golden-hour-poster.webp',
      '/showcase/island-arrival-poster.webp',
      '/showcase/golden-coast-poster.webp',
      '/showcase/atelier-day-poster.webp',
    ]),
  );
});

/**
 * Romance is a label the gallery renders, not a value the database can store.
 * The filter has to work anyway, or a category with a film in it is a dead end.
 */
test('the Romance filter works, though no row can be Romance', async ({ page }) => {
  await page.goto('/portfolio');
  await page.getByRole('link', { name: 'Romance', exact: true }).click();

  await expect(page).toHaveURL(/category=ROMANCE/);
  const headings = await page.locator('h2').allTextContents();
  expect(headings).toEqual(['Golden Coast']);
  await expect(page.locator('video')).toHaveCount(1);
});

/**
 * Seven films on one page is where "poster-first" stops being a nicety. The
 * gallery must still cost seven posters, not seven films.
 */
test('opening the gallery downloads posters, not films', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/showcase/')) requested.push(url.pathname);
  });

  await page.goto('/portfolio', { waitUntil: 'networkidle' });

  expect(
    requested.filter((path) => path.endsWith('.mp4')),
    'a film was fetched',
  ).toEqual([]);
  expect(requested.filter((path) => path.endsWith('.webp')).length).toBeGreaterThan(0);
});

/**
 * The transformation proof. Its whole job is to be understood without reading:
 * an ordinary picture, a sentence, a film.
 */
test('the transformation shows a real input, an idea and a result', async ({ page }) => {
  await page.goto('/');

  const section = page.locator('section[aria-labelledby="transform-heading"]');
  const reference = section.locator('img[src="/showcase/midnight-yacht-reference.webp"]');

  await expect(reference).toHaveAttribute(
    'alt',
    'The reference image used to create the Midnight Yacht concept',
  );
  // Below the fold, so it waits its turn.
  await expect(reference).toHaveAttribute('loading', 'lazy');
  // Dimensions on the element, so the box is reserved and nothing shifts.
  await expect(reference).toHaveAttribute('width', '1122');
  await expect(reference).toHaveAttribute('height', '1402');

  // Uncropped: rendered at the image's own ratio, not the panel's.
  const ratio = await reference.evaluate((image) => {
    const box = image.getBoundingClientRect();
    return box.width / box.height;
  });
  expect(ratio).toBeGreaterThan(0.76);
  expect(ratio).toBeLessThan(0.84);

  const text = (await section.textContent()) ?? '';
  expect(text).toContain('Your photo');
  expect(text).toContain('Your idea');
  expect(text).toContain('The cinematic result');
  expect(text).toContain('not a customer project');

  // The section must never claim the input came from a customer.
  for (const claim of ['Original reference photograph', 'supplied by a customer']) {
    expect(text, `the section says "${claim}"`).not.toContain(claim);
  }
});

test('the flagship film is muted before it is ever asked to play', async ({ page }) => {
  await page.goto('/');

  const flagship = page.locator('video').first();
  await expect(flagship).toHaveAttribute('poster', /midnight-yacht-poster\.webp$/);
  // Set by the autoplay path before play() is called, so it holds whether or
  // not this browser can decode the file.
  await expect
    .poll(() => flagship.evaluate((element: HTMLVideoElement) => element.muted))
    .toBe(true);

  await expect(page.getByText(/not a customer project\./)).toBeVisible();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the flagship never attempts to play, and keeps its poster and controls', async ({
    page,
  }) => {
    await page.goto('/');

    const flagship = page.locator('video').first();
    const state = await flagship.evaluate((element: HTMLVideoElement) => ({
      paused: element.paused,
      // Untouched: the autoplay path returns before it would mute anything.
      muted: element.muted,
      loop: element.loop,
      controls: element.controls,
      poster: element.poster,
    }));

    expect(state.paused).toBe(true);
    expect(state.muted).toBe(false);
    expect(state.loop).toBe(false);
    expect(state.controls, 'reduced motion must leave a usable player').toBe(true);
    expect(state.poster, 'a still, never a blank frame').toMatch(/midnight-yacht-poster\.webp$/);
  });
});
