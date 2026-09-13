import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAGSHIP_FILM, SHOWCASE_FILMS, galleryItems } from '@/lib/catalog/showcase';
import { prose, readSource as read } from './support/source';

const ROOT = process.cwd();

const PLAYER = 'features/media/cinematic-video.tsx';

/**
 * Two films, about 2 MB each, served from /public. Small enough to live in the
 * repository; not small enough to send to somebody who did not ask for them.
 */
describe('showcase media', () => {
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
    for (const film of SHOWCASE_FILMS) {
      expect(film.posterUrl, film.slug).toMatch(/\.(webp|jpg|jpeg|png)$/);
    }
    expect(read(PLAYER)).toMatch(/poster=\{posterUrl\}/);
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
  it('opens with the two films we can actually play', () => {
    const items = galleryItems([]);
    expect(items.slice(0, 2).map((item) => item.title)).toEqual([
      'Midnight Yacht',
      'Garden Wedding',
    ]);
    expect(items.every((item) => item.film !== null || item.provenance === null)).toBe(true);
  });

  it('carries each film into the create flow through its experience', () => {
    for (const film of SHOWCASE_FILMS) {
      expect(film.experienceSlug, film.slug).toBeTruthy();
    }
  });
});
