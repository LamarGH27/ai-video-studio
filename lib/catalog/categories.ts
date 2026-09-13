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
