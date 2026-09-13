import type { PortfolioProvenance } from '@/lib/catalog/presentation';
import type { ExperienceCategory } from '@/types/database';

/**
 * The films we can actually show, declared in code.
 *
 * These are real pieces with real media, but they are not rows in
 * `portfolio_items` and deliberately do not become rows: migrations 000000
 * through 000700 are deployed and immutable, and a film is not a schema change.
 * Keeping them here means a new piece is a pull request — media in
 * `public/showcase`, an entry below — with nothing to migrate and nothing that
 * can drift out of sync with the files on disk.
 *
 * `provenance` is stated rather than inferred. Both of these were made by us to
 * demonstrate what the service produces; neither was commissioned by a
 * customer, and having real media must never be what decides that. See
 * lib/catalog/presentation.ts.
 *
 * Media lives under /public and is served as a static asset. At this size (two
 * ten-second films, ~2 MB each) that is the right home: no signed URLs to
 * expire, no bucket to configure, no request to Supabase on a marketing page
 * that is statically rendered. The day this becomes a real library rather than
 * two pieces — say a dozen films, or anything approaching 50 MB — it moves to
 * object storage behind a CDN and only `videoUrl`/`posterUrl` change.
 */

export type ShowcaseAspect = 'video' | 'square' | 'portrait';

export interface ShowcaseFilm {
  slug: string;
  title: string;
  category: ExperienceCategory;
  /** Pre-selects the matching experience in the create flow. */
  experienceSlug: string;
  /** Stated, never derived. */
  provenance: PortfolioProvenance;
  /** Card copy. One sentence. */
  shortCopy: string;
  /** Gallery copy, for the piece's own card. */
  longCopy: string;
  videoUrl: string;
  posterUrl: string;
  /** The film's real shape. Both are 1280x720. */
  aspect: ShowcaseAspect;
  /** Leads the gallery and the homepage strip. */
  featured: boolean;
}

export const SHOWCASE_FILMS: readonly ShowcaseFilm[] = [
  {
    slug: 'midnight-yacht',
    title: 'Midnight Yacht',
    category: 'LUXURY_LIFESTYLE',
    experienceSlug: 'luxury-lifestyle',
    provenance: 'CONCEPT',
    shortCopy: 'A private yacht. Fireworks overhead. A cinematic night built around you.',
    longCopy:
      'A luxury night-time concept set aboard a private yacht, with elegant styling, moonlit water, fireworks and a celebratory atmosphere built around the subject.',
    videoUrl: '/showcase/midnight-yacht.mp4',
    posterUrl: '/showcase/midnight-yacht-poster.webp',
    aspect: 'video',
    featured: true,
  },
  {
    slug: 'garden-wedding',
    title: 'Garden Wedding',
    category: 'CELEBRATION',
    experienceSlug: 'celebration',
    provenance: 'CONCEPT',
    shortCopy:
      'A graceful arrival at an outdoor wedding, styled with warmth, poise and quiet luxury.',
    longCopy:
      'An elegant outdoor-wedding concept combining formal styling, warm natural light and a refined cinematic atmosphere.',
    videoUrl: '/showcase/garden-wedding.mp4',
    posterUrl: '/showcase/garden-wedding-poster.webp',
    aspect: 'video',
    featured: true,
  },
] as const;

export function showcaseFilm(slug: string): ShowcaseFilm | undefined {
  return SHOWCASE_FILMS.find((film) => film.slug === slug);
}

/** The piece the homepage leads with. */
export const FLAGSHIP_FILM = SHOWCASE_FILMS[0] as ShowcaseFilm;

/**
 * One list for the gallery: the films we can play, then the concepts we can
 * only describe.
 *
 * Structural rather than importing PortfolioEntry, because lib/data/portfolio
 * is `server-only` and this module is reachable from a client component.
 */
export interface PortfolioEntryLike {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: ExperienceCategory;
  experienceSlug: string | null;
}

export interface GalleryItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: ExperienceCategory;
  provenance: PortfolioProvenance | null;
  experienceSlug: string | null;
  /** Present only where we hold real media. */
  film: ShowcaseFilm | null;
}

export function galleryItems(entries: readonly PortfolioEntryLike[]): GalleryItem[] {
  const films: GalleryItem[] = SHOWCASE_FILMS.map((film) => ({
    id: film.slug,
    slug: film.slug,
    title: film.title,
    description: film.longCopy,
    category: film.category,
    provenance: film.provenance,
    experienceSlug: film.experienceSlug,
    film,
  }));

  // A slug declared above wins over the same slug in the database, so adding a
  // row later augments a film rather than listing it twice.
  const claimed = new Set(films.map((item) => item.slug));

  const rest: GalleryItem[] = entries
    .filter((entry) => !claimed.has(entry.slug))
    .map((entry) => ({
      id: entry.id,
      slug: entry.slug,
      title: entry.title,
      description: entry.description,
      category: entry.category,
      // No provenance column exists, and none is being added. Unstated means
      // concept, which is the honest default.
      provenance: null,
      experienceSlug: entry.experienceSlug,
      film: null,
    }));

  return [...films, ...rest];
}
