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

const CATEGORY_LABELS: Record<ExperienceCategory, string> = {
  LUXURY_LIFESTYLE: 'Luxury Lifestyle',
  FASHION: 'Fashion',
  CINEMATIC: 'Cinematic',
  SOCIAL_MEDIA: 'Social Media',
  CELEBRATION: 'Celebration',
  TRAVEL: 'Travel',
  EXECUTIVE: 'Executive / Boss',
  BESPOKE: 'Bespoke',
};

export function categoryLabel(category: ExperienceCategory): string {
  return CATEGORY_LABELS[category];
}

export function isExperienceCategory(value: string): value is ExperienceCategory {
  return (EXPERIENCE_CATEGORIES as readonly string[]).includes(value);
}
