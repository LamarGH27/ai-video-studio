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
 * `provenance` is stated rather than inferred. Every one of these was made by us
 * to demonstrate what the service produces; none was commissioned by a customer,
 * and having real media must never be what decides that. See
 * lib/catalog/presentation.ts.
 *
 * Media lives under /public and is served as a static asset. At this size (five
 * ten-second films, under 2.5 MB each, ~11 MB in total) that is still the right
 * home: no signed URLs to expire, no bucket to configure, no request to Supabase
 * on a marketing page that is statically rendered. Nothing downloads until
 * somebody presses play, so the page weight is five posters, not five films.
 * The threshold for moving to object storage behind a CDN is a dozen films or
 * 50 MB, whichever comes first; at that point only `videoUrl`/`posterUrl`
 * change. tests/showcase-media.test.ts enforces the per-file budget.
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
  /** The film's real shape. All eight are 1280x720. */
  aspect: ShowcaseAspect;
  /** Leads the gallery and the homepage strip. */
  featured: boolean;
  /**
   * How much room the piece takes in the gallery grid.
   *
   * Declared per film rather than derived from position, because "every other
   * one is wide" is a pattern a visitor notices and stops reading.
   *
   * `anchor` opens the gallery at full width and `closer` ends it the same way;
   * everything between them reads as pairs. The two wide slots are bookends, so
   * there is exactly one of each — a third would turn a composition back into
   * alternating stripes. The pair grid needs an even number of `standard`
   * films or the last one is stranded beside a gap, which is what made a
   * `closer` necessary at eight films: seven was one anchor and three pairs,
   * eight is one anchor, three pairs and an ending.
   */
  emphasis: 'anchor' | 'standard' | 'closer';
}

/**
 * Ordered for the page, not by date added.
 *
 * The flagship anchors at full width; the other six read as three pairs, and
 * each pair is built to contrast inside itself — daylight beside night, warm
 * interior beside open water. Ordering these by when they arrived would have
 * put the two dark night films together at the bottom, which turns the end of
 * the gallery into a slump. Ordering them alphabetically would be an accident
 * pretending to be a decision.
 */
/**
 * Ordered for the page, not by date added.
 *
 * The flagship opens at full width and The Suite closes the same way; the six
 * between them read as three pairs, and each pair is built to contrast inside
 * itself — warm dusk beside cool night, warm interior beside open water, bright
 * garden beside grey glass. The two wide slots are bookends on purpose: the
 * gallery starts on spectacle and ends on quiet, and both of those pieces are
 * Luxury Lifestyle, which is the clearest way to say that one category holds
 * very different films.
 *
 * Golden Hour sits immediately after the anchor because it is the first film in
 * the library led by someone other than the same man, and a visitor decides
 * whether a service is for them from the first two or three things they see,
 * not from the eighth.
 *
 * Ordering by arrival date would have put the newest films at the bottom where
 * fewest people reach them. Ordering alphabetically would be an accident
 * pretending to be a decision.
 */
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
    emphasis: 'anchor',
  },
  {
    slug: 'golden-hour',
    title: 'Golden Hour',
    category: 'CELEBRATION',
    experienceSlug: 'celebration',
    provenance: 'CONCEPT',
    shortCopy: 'A milestone moment transformed into a celebration that feels made for film.',
    longCopy:
      'A warm, elegant celebration concept centred on confidence, connection and a milestone worth remembering, showing how an everyday photograph can become the centre of a cinematic occasion.',
    videoUrl: '/showcase/golden-hour.mp4',
    posterUrl: '/showcase/golden-hour-poster.webp',
    aspect: 'video',
    featured: true,
    emphasis: 'standard',
  },
  {
    slug: 'after-hours',
    title: 'After Hours',
    category: 'CINEMATIC',
    experienceSlug: 'cinematic',
    provenance: 'CONCEPT',
    shortCopy: 'A night in the city transformed into something that feels straight out of film.',
    longCopy:
      'A sophisticated urban-night concept built around confidence, atmosphere and cinematic city energy, turning an evening in the city into something closer to the opening sequence of a premium film.',
    videoUrl: '/showcase/after-hours.mp4',
    posterUrl: '/showcase/after-hours-poster.webp',
    aspect: 'video',
    featured: true,
    emphasis: 'standard',
  },
  {
    slug: 'atelier-day',
    title: 'Atelier Day',
    category: 'FASHION',
    experienceSlug: 'fashion',
    provenance: 'CONCEPT',
    shortCopy: 'Personal style, confidence and a luxury day out captured like a fashion film.',
    longCopy:
      'A fashion-led luxury shopping concept built around refined personal style, confident movement and an editorial cinematic finish.',
    videoUrl: '/showcase/atelier-day.mp4',
    posterUrl: '/showcase/atelier-day-poster.webp',
    aspect: 'video',
    featured: true,
    emphasis: 'standard',
  },
  {
    slug: 'island-arrival',
    title: 'Island Arrival',
    category: 'TRAVEL',
    experienceSlug: 'travel',
    provenance: 'CONCEPT',
    shortCopy: 'From an everyday photograph to somewhere extraordinary.',
    longCopy:
      'A tropical travel concept built around escape, freedom and premium destination storytelling, turning an ordinary reference image into an aspirational cinematic journey.',
    videoUrl: '/showcase/island-arrival.mp4',
    posterUrl: '/showcase/island-arrival-poster.webp',
    aspect: 'video',
    featured: true,
    emphasis: 'standard',
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
    emphasis: 'standard',
  },
  {
    slug: 'executive-presence',
    title: 'Executive Presence',
    // Stored as EXECUTIVE, shown as "Personal Brand". The identifier is in an
    // applied migration and in rows; only the label moves.
    category: 'EXECUTIVE',
    experienceSlug: 'executive',
    provenance: 'CONCEPT',
    shortCopy: 'Confidence, ambition and presence translated into a cinematic personal-brand film.',
    longCopy:
      'A polished city concept built around modern tailoring, architecture and quiet confidence, designed to show how personal branding can feel cinematic rather than corporate.',
    videoUrl: '/showcase/executive-presence.mp4',
    posterUrl: '/showcase/executive-presence-poster.webp',
    aspect: 'video',
    featured: true,
    emphasis: 'standard',
  },
  {
    slug: 'the-suite',
    title: 'The Suite',
    // Shares Luxury Lifestyle with the flagship on purpose. One category
    // holding a firework-lit deck and a quiet hotel window says more about the
    // range of the service than inventing a seventh category would.
    category: 'LUXURY_LIFESTYLE',
    experienceSlug: 'luxury-lifestyle',
    provenance: 'CONCEPT',
    shortCopy: 'Quiet luxury, city lights and a moment that feels entirely your own.',
    longCopy:
      'A refined hotel-suite concept centred on calm confidence, warm interiors and city views, showing that cinematic personal storytelling does not need spectacle to feel premium.',
    videoUrl: '/showcase/the-suite.mp4',
    posterUrl: '/showcase/the-suite-poster.webp',
    aspect: 'video',
    featured: true,
    emphasis: 'closer',
  },
] as const;

export function showcaseFilm(slug: string): ShowcaseFilm | undefined {
  return SHOWCASE_FILMS.find((film) => film.slug === slug);
}

/** The piece the homepage leads with. */
export const FLAGSHIP_FILM = SHOWCASE_FILMS[0] as ShowcaseFilm;

/**
 * The four films in the homepage strip, chosen rather than sliced.
 *
 * The homepage is arguing that the service covers what somebody might want a
 * film FOR, so these are four different reasons to buy one — a celebration, a
 * wardrobe, a professional presence, a journey — not the four most recent
 * pieces. The rule is one film per customer motivation.
 *
 * Golden Hour holds the celebration slot in place of Garden Wedding. It was the
 * only swap that cost nothing: both are Celebration, so the four motivations
 * are untouched, and it is the one film in the library not led by the same man.
 * Four cards showing one person read as one person's showreel, whatever the
 * copy underneath says, and the homepage is where somebody decides whether this
 * service is for them. Garden Wedding keeps its place in the gallery.
 *
 * Two deliberate omissions. After Hours is a strong piece, but "it can look
 * like a film" is the question the flagship directly above it already answers;
 * spending a slot on mood would cost a slot on a motivation. The Suite is quiet
 * Luxury Lifestyle, which the flagship also occupies. Both earn their place in
 * the gallery, where range is the point; the homepage is making a narrower
 * argument.
 */
export const HOMEPAGE_STRIP: readonly ShowcaseFilm[] = [
  'golden-hour',
  'atelier-day',
  'executive-presence',
  'island-arrival',
].map((slug) => {
  const film = SHOWCASE_FILMS.find((candidate) => candidate.slug === slug);
  if (!film) throw new Error(`Homepage strip names a film that does not exist: ${slug}`);
  return film;
});

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
