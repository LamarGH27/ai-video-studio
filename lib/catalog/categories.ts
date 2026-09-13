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
 * `EXECUTIVE` is stored as `EXECUTIVE` and shown as "Executive Presence":
 * "Boss" was doing the opposite of the job, reading as a stock-photo category
 * rather than as something a founder would commission.
 */
const CATEGORY_LABELS: Record<ExperienceCategory, string> = {
  LUXURY_LIFESTYLE: 'Luxury Lifestyle',
  FASHION: 'Fashion',
  CINEMATIC: 'Cinematic',
  SOCIAL_MEDIA: 'Social Media',
  CELEBRATION: 'Celebration',
  TRAVEL: 'Travel',
  EXECUTIVE: 'Executive Presence',
  BESPOKE: 'Bespoke',
};

export function categoryLabel(category: ExperienceCategory): string {
  return CATEGORY_LABELS[category];
}

export function isExperienceCategory(value: string): value is ExperienceCategory {
  return (EXPERIENCE_CATEGORIES as readonly string[]).includes(value);
}
