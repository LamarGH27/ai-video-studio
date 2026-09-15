import type { ExperienceCategory } from '@/types/database';

/** Display order for category filters across the portfolio and /create. */
export const EXPERIENCE_CATEGORIES: readonly ExperienceCategory[] = [
  'LUXURY_LIFESTYLE',
  'FASHION',
  'CINEMATIC',
  'SOCIAL_MEDIA',
  'CELEBRATION',
  'TRAVEL',
  'EXECUTIVE',
  'BESPOKE',
] as const;

/**
 * What each category is CALLED, as distinct from what it is stored as.
 *
 * The enum values are database identifiers and are immutable — they are written
 * into applied migrations and into every row. This map is the only place a
 * human-facing name is decided, so renaming one is a presentation change with
 * no data migration behind it.
 *
 * `EXECUTIVE` is stored as `EXECUTIVE` and shown as "Personal Brand". It has
 * moved twice: "Boss" read as a stock-photo category rather than something a
 * founder would commission, and "Executive Presence" then collided with the
 * film of that name, so every card in the category read "Executive Presence /
 * Executive Presence". The category is the kind of work; the film is the piece.
 * `lib/catalog/presentation.ts` still shows the *experience* a customer picks
 * as "Executive Presence", which is the thing they are buying.
 *
 * `TRAVEL` is shown as "Travel & Adventure": the films in it are about going
 * somewhere, not about transit.
 */
const CATEGORY_LABELS: Record<ExperienceCategory, string> = {
  LUXURY_LIFESTYLE: 'Luxury Lifestyle',
  FASHION: 'Fashion',
  CINEMATIC: 'Cinematic',
  SOCIAL_MEDIA: 'Social Media',
  CELEBRATION: 'Celebration',
  TRAVEL: 'Travel & Adventure',
  EXECUTIVE: 'Personal Brand',
  BESPOKE: 'Bespoke',
};

export function categoryLabel(category: ExperienceCategory): string {
  return CATEGORY_LABELS[category];
}

export function isExperienceCategory(value: string): value is ExperienceCategory {
  return (EXPERIENCE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Categories the public gallery can DISPLAY, which is a wider set than the
 * categories the database can STORE.
 *
 * `experience_category` is a Postgres enum created in
 * 20260101000000_initial_schema.sql. That migration is deployed and immutable,
 * every `portfolio_items` and `video_experiences` row is typed by it, and a
 * showcase label is not a reason to alter a type that customer orders depend
 * on. So Romance exists here and nowhere else: no migration, no enum change, no
 * persisted value.
 *
 * The split is load-bearing rather than cosmetic. `ExperienceCategory` stays the
 * type of anything that round-trips through the database — rows, orders, the
 * create flow — and `ShowcaseCategory` is only ever the type of something we
 * declare in code and render. A film can be Romance; a project cannot, and the
 * types say so.
 *
 * When Romance becomes something a customer can actually order, it becomes an
 * enum value in a new migration and moves up into `ExperienceCategory`, and
 * this extra member disappears. Until then, claiming the database knows about
 * it would be a lie the type system would happily tell.
 */
export type ShowcaseCategory = ExperienceCategory | 'ROMANCE';

/** Display order for the Concept Gallery filters. */
export const SHOWCASE_CATEGORIES: readonly ShowcaseCategory[] = [
  ...EXPERIENCE_CATEGORIES,
  'ROMANCE',
] as const;

const SHOWCASE_ONLY_LABELS: Record<Exclude<ShowcaseCategory, ExperienceCategory>, string> = {
  ROMANCE: 'Romance',
};

export function showcaseCategoryLabel(category: ShowcaseCategory): string {
  return isExperienceCategory(category)
    ? categoryLabel(category)
    : SHOWCASE_ONLY_LABELS[category as Exclude<ShowcaseCategory, ExperienceCategory>];
}

export function isShowcaseCategory(value: string): value is ShowcaseCategory {
  return (SHOWCASE_CATEGORIES as readonly string[]).includes(value);
}
