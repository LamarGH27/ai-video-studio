import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLAGSHIP_FILM,
  HOMEPAGE_STRIP,
  SHOWCASE_FILMS,
  galleryItems,
} from '@/lib/catalog/showcase';
import { EXPERIENCE_CATEGORIES, categoryLabel } from '@/lib/catalog/categories';
import {
  isConceptOnlyGallery,
  portfolioProvenance,
  provenanceLabel,
} from '@/lib/catalog/presentation';
import { prose, readSource as read } from './support/source';

const ROOT = process.cwd();

const PLAYER = 'features/media/cinematic-video.tsx';

/**
 * Five films, under 2.5 MB each, served from /public. Small enough to live in
 * the repository; not small enough to send to somebody who did not ask for them.
 */
describe('showcase media', () => {
  it('has all eight films, in the order the gallery leads with', () => {
    expect(SHOWCASE_FILMS.map((film) => film.slug)).toEqual([
      'midnight-yacht',
      'golden-hour',
      'after-hours',
      'atelier-day',
      'island-arrival',
      'garden-wedding',
      'executive-presence',
      'the-suite',
    ]);
  });

  /**
   * The wide slots are bookends: the anchor opens the gallery, the closer ends
   * it, and everything between reads as pairs. An odd number of standard films
   * would strand the last one beside a gap — which is exactly what the eighth
   * film would have done to the old one-anchor-and-pairs grid. This is where
   * that gets caught, rather than in a screenshot.
   */
  it('opens and closes on a full-width film, with pairs between', () => {
    const wide = SHOWCASE_FILMS.filter((film) => film.emphasis !== 'standard');
    expect(wide.map((film) => film.emphasis)).toEqual(['anchor', 'closer']);
    // And they are the first and last pieces, not wide slots in the middle.
    expect(SHOWCASE_FILMS.at(0)?.emphasis).toBe('anchor');
    expect(SHOWCASE_FILMS.at(-1)?.emphasis).toBe('closer');
  });

  it('leaves no film stranded in the pair grid', () => {
    const standard = SHOWCASE_FILMS.filter((film) => film.emphasis === 'standard');
    expect(standard.length % 2, 'a lone film would sit beside an empty column').toBe(0);
  });

  /**
   * Golden Hour exists because seven films led by the same man read as one
   * person's showreel. Putting it eighth would have wasted it: a visitor
   * decides whether a service is for them from the first few things they see.
   */
  it('puts the film that widens the gallery near the top of it', () => {
    const position = SHOWCASE_FILMS.findIndex((film) => film.slug === 'golden-hour');
    expect(position, 'Golden Hour must be the first film after the anchor').toBe(1);
  });

  /**
   * Range is the argument the gallery is making: five films that all look like
   * the same shoot prove less than two that do not.
   */
  it('covers six categories across eight films', () => {
    const categories = SHOWCASE_FILMS.map((film) => film.category);
    expect(new Set(categories)).toEqual(
      new Set(['LUXURY_LIFESTYLE', 'CELEBRATION', 'CINEMATIC', 'FASHION', 'TRAVEL', 'EXECUTIVE']),
    );
    // Every category a film claims must be one the filter nav can show.
    for (const category of categories) {
      expect(EXPERIENCE_CATEGORIES, `${category} is not a filterable category`).toContain(category);
      expect(categoryLabel(category), `${category} has no label`).toBeTruthy();
    }
  });

  /**
   * Two films in one category is the point, not an accident: a firework-lit
   * deck and a quiet hotel window under the same heading say more about the
   * range of the service than a seventh category invented to keep them apart.
   */
  it('lets one category hold more than one film', () => {
    const luxury = SHOWCASE_FILMS.filter((film) => film.category === 'LUXURY_LIFESTYLE');
    expect(luxury.map((film) => film.slug)).toEqual(['midnight-yacht', 'the-suite']);
    const celebration = SHOWCASE_FILMS.filter((film) => film.category === 'CELEBRATION');
    expect(celebration.map((film) => film.slug)).toEqual(['golden-hour', 'garden-wedding']);
  });

  it('says every film is a concept, and calls none of them a commission', () => {
    for (const film of SHOWCASE_FILMS) {
      expect(film.provenance, film.slug).toBe('CONCEPT');
      expect(provenanceLabel(portfolioProvenance(film)), film.slug).toBe('Concept');
      const copy = `${film.shortCopy} ${film.longCopy}`;
      expect(copy, film.slug).not.toMatch(/commission|client work|case study|customer film/i);
    }
  });

  /**
   * One anchor. "Every other film is wide" is a pattern a visitor notices and
   * stops reading; one hero and four equals is a composition.
   */
  it('anchors the grid on exactly one film, and it is the flagship', () => {
    const anchors = SHOWCASE_FILMS.filter((film) => film.emphasis === 'anchor');
    expect(anchors.map((film) => film.slug)).toEqual(['midnight-yacht']);
  });

  it('ships every file the registry points at', () => {
    for (const film of SHOWCASE_FILMS) {
      for (const url of [film.videoUrl, film.posterUrl]) {
        expect(url, `${film.slug}: ${url} must be a root-relative static asset`).toMatch(/^\//);
        const stats = statSync(join(ROOT, 'public', url));
        expect(stats.isFile(), `${url} is missing from public/`).toBe(true);
      }
    }
  });

  it('keeps each film inside a sane budget for a marketing page', () => {
    for (const film of SHOWCASE_FILMS) {
      const video = statSync(join(ROOT, 'public', film.videoUrl)).size;
      const poster = statSync(join(ROOT, 'public', film.posterUrl)).size;
      expect(video, `${film.slug} film`).toBeLessThan(4_000_000);
      expect(poster, `${film.slug} poster`).toBeLessThan(250_000);
    }
  });

  /**
   * Every gallery thumbnail is a poster image. A <video> with no poster paints
   * the first decoded frame, or black before it has one — which is the state
   * this asserts we never ship.
   */
  it('gives every film a poster, so no frame is ever black', () => {
    expect(SHOWCASE_FILMS).toHaveLength(8);
    for (const film of SHOWCASE_FILMS) {
      expect(film.posterUrl, film.slug).toMatch(/\.(webp|jpg|jpeg|png)$/);
      // Named after the film, so a mismatched pair is visible in a diff.
      expect(film.posterUrl, film.slug).toContain(film.slug);
      expect(film.videoUrl, film.slug).toContain(film.slug);
    }
    expect(read(PLAYER)).toMatch(/poster=\{posterUrl\}/);
  });

  /**
   * The documented threshold for moving off static assets is a dozen films or
   * 50 MB. This fails well before either becomes a surprise.
   */
  it('keeps the whole library inside the static-hosting threshold', () => {
    const total = SHOWCASE_FILMS.reduce(
      (sum, film) =>
        sum +
        statSync(join(ROOT, 'public', film.videoUrl)).size +
        statSync(join(ROOT, 'public', film.posterUrl)).size,
      0,
    );
    expect(total).toBeLessThan(50_000_000);
  });
});

describe('playback restraint', () => {
  const player = read(PLAYER);

  it('never downloads a film until it is wanted', () => {
    // preload="none" on the element itself, not a prop a caller could forget.
    expect(player).toMatch(/preload="none"/);
    expect(prose(PLAYER)).not.toMatch(/preload="(auto|metadata)"/);
  });

  /**
   * The `autoPlay` attribute would start a download during hydration, before
   * any of the reduced-motion or connection checks could run. Autoplay is
   * therefore only ever reached through play(), never through markup.
   */
  it('has no autoplay attribute anywhere in the markup', () => {
    expect(prose(PLAYER)).not.toMatch(/\bautoPlay\b/);
  });

  it('autoplays muted, looping, and inline or not at all', () => {
    expect(player).toMatch(/video\.muted = true;/);
    expect(player).toMatch(/video\.loop = true;/);
    expect(player).toMatch(/playsInline/);
  });

  it('withdraws autoplay for reduced motion and for constrained connections', () => {
    expect(player).toMatch(/prefers-reduced-motion: reduce/);
    expect(player).toMatch(/saveData/);
    expect(player).toMatch(/slow-2g/);
    // A refused play() must not leave a dead frame.
    expect(player).toMatch(/\.catch\(/);
  });

  it('keeps controls reachable whenever the film is not autoplaying', () => {
    expect(player).toMatch(/controls=\{!autoplaying\}/);
    // And real buttons, in the tab order, while it is.
    expect(player).toMatch(/label=\{`Pause \$\{title\}`\}/);
    expect(player).toMatch(/aria-label=\{label\}/);
    expect(player).toMatch(/Turn on sound for/);
  });

  /**
   * One autoplaying film per page, and only the flagship. Two films playing at
   * once is a bandwidth problem before it is a taste problem.
   */
  it('autoplays in exactly one place in the whole application', () => {
    const sources = [
      'app/(marketing)/page.tsx',
      'app/(marketing)/portfolio/page.tsx',
      'features/marketing/transformation.tsx',
    ];
    const uses = sources.flatMap((path) => read(path).match(/mode="autoplay"/g) ?? []);
    expect(uses).toHaveLength(1);
    expect(read('features/marketing/transformation.tsx')).toMatch(/mode="autoplay"/);
  });

  it('gives the gallery no autoplay at all', () => {
    expect(prose('app/(marketing)/portfolio/page.tsx')).not.toMatch(/mode="autoplay"/);
  });
});

/**
 * The homepage argues that the service covers what somebody might want a film
 * FOR. Four slots, four different reasons — not the four most recent pieces.
 */
describe('the homepage strip', () => {
  it('shows four films, each a different reason to buy one', () => {
    expect(HOMEPAGE_STRIP).toHaveLength(4);
    const categories = HOMEPAGE_STRIP.map((film) => film.category);
    expect(new Set(categories).size, 'two slots spent on one motivation').toBe(4);
  });

  /**
   * Four cards showing one person read as one person's showreel, whatever the
   * copy underneath says. Golden Hour took the celebration slot from Garden
   * Wedding — same category, so no motivation was lost for it.
   */
  it('does not present the whole service through a single subject', () => {
    expect(HOMEPAGE_STRIP.map((film) => film.slug)).toContain('golden-hour');
    expect(HOMEPAGE_STRIP.map((film) => film.slug)).not.toContain('garden-wedding');
  });

  it('does not spend a slot on the film already at the top of the page', () => {
    expect(HOMEPAGE_STRIP.map((film) => film.slug)).not.toContain(FLAGSHIP_FILM.slug);
    // Nor on the other film in the flagship's category.
    expect(HOMEPAGE_STRIP.every((film) => film.category !== FLAGSHIP_FILM.category)).toBe(true);
  });

  it('is a declared list, not a slice of the gallery', () => {
    const page = read('app/(marketing)/page.tsx');
    expect(page).toMatch(/const strip = HOMEPAGE_STRIP;/);
    expect(prose('app/(marketing)/page.tsx')).not.toMatch(/gallery\.slice/);
  });

  it('only names films that exist', () => {
    for (const film of HOMEPAGE_STRIP) {
      expect(SHOWCASE_FILMS, film.slug).toContain(film);
    }
  });
});

describe('the flagship', () => {
  it('is Midnight Yacht, and is a concept', () => {
    expect(FLAGSHIP_FILM.slug).toBe('midnight-yacht');
    expect(FLAGSHIP_FILM.provenance).toBe('CONCEPT');
  });

  it('is the piece the homepage transformation resolves to', () => {
    const page = read('app/(marketing)/page.tsx');
    expect(page).toMatch(/film: FLAGSHIP_FILM/);
    expect(page).toMatch(/The cinematic result/);
  });

  it('is labelled as a demonstration exactly once, under the sequence', () => {
    const source = read('features/marketing/transformation.tsx');
    expect(source).toMatch(/Demonstration concept — not a customer project\./);
    expect(source.match(/Demonstration concept/g)).toHaveLength(1);
  });

  /**
   * The reference panel stands for the visitor's own photograph. Until somebody
   * gives us one they are happy to publish, it stays a designed placeholder —
   * a stock face there would fake the exact thing the section demonstrates.
   */
  it('does not invent a reference photograph', () => {
    const page = read('app/(marketing)/page.tsx');
    expect(page).toMatch(/mark: 'Reference'/);
    expect(prose('app/(marketing)/page.tsx')).not.toMatch(/reference[-\w]*\.(jpg|jpeg|png|webp)/i);
  });
});

describe('the gallery', () => {
  it('opens with the eight films we can actually play', () => {
    const items = galleryItems([]);
    expect(items.slice(0, 8).map((item) => item.title)).toEqual([
      'Midnight Yacht',
      'Golden Hour',
      'After Hours',
      'Atelier Day',
      'Island Arrival',
      'Garden Wedding',
      'Executive Presence',
      'The Suite',
    ]);
  });

  /**
   * A placeholder must never outrank a film. The page renders the two in
   * separate grids for that reason; this asserts the ordering the split
   * depends on.
   */
  it('puts every real film ahead of every placeholder', () => {
    const items = galleryItems([
      {
        id: 'db-1',
        slug: 'archive-no-4',
        title: 'Archive No. 4',
        description: null,
        category: 'BESPOKE',
        experienceSlug: 'custom-concept',
      },
    ]);

    const filmIndexes = items.flatMap((item, index) => (item.film ? [index] : []));
    const lastFilm = Math.max(...filmIndexes);
    const firstPlaceholder = items.findIndex((item) => item.film === null);
    expect(lastFilm).toBeLessThan(firstPlaceholder);
    expect(isConceptOnlyGallery(items), 'real media must not imply a commission').toBe(true);
  });

  it('gives the wide slots their full row, and only them', () => {
    const page = read('app/(marketing)/portfolio/page.tsx');
    expect(page).toMatch(/entry\.film\?\.emphasis !== 'standard' && 'lg:col-span-2'/);
  });

  it('renders films and placeholders as separate grids, films first', () => {
    const page = read('app/(marketing)/portfolio/page.tsx');
    expect(page).toMatch(/const films = visible\.filter/);
    expect(page).toMatch(/const concepts = visible\.filter/);
    expect(page.indexOf('{films.map(')).toBeLessThan(page.indexOf('{concepts.map('));
  });

  it('carries each film into the create flow through its experience', () => {
    for (const film of SHOWCASE_FILMS) {
      expect(film.experienceSlug, film.slug).toBeTruthy();
    }
  });
});
