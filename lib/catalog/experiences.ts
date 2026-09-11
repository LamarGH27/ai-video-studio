import type { ExperienceCategory, VideoExperienceRow } from '@/types/database';

/**
 * Fallback experience catalogue.
 *
 * video_experiences in Postgres is the source of truth — these definitions are
 * seeded there by supabase/migrations/20260101000300_seed_reference_data.sql,
 * and /create reads the table at runtime so the list can be curated
 * commercially without a deploy.
 *
 * This copy exists so the marketing pages still render when Supabase is
 * unreachable or not yet configured (fresh clone, preview build). Anything that
 * WRITES a project always uses the database row and its real UUID; a fallback
 * entry has no id and cannot be submitted against.
 */

export interface ExperienceDefinition {
  slug: string;
  name: string;
  description: string;
  category: ExperienceCategory;
  sortOrder: number;
}

export const EXPERIENCE_DEFINITIONS: readonly ExperienceDefinition[] = [
  {
    slug: 'luxury-lifestyle',
    name: 'Luxury Lifestyle',
    description:
      'Yachts, penthouses and private terraces. Slow, considered camera moves and a sense of arrival.',
    category: 'LUXURY_LIFESTYLE',
    sortOrder: 10,
  },
  {
    slug: 'fashion',
    name: 'Fashion',
    description:
      'Editorial movement and styling. Built around wardrobe, silhouette and a strong colour story.',
    category: 'FASHION',
    sortOrder: 20,
  },
  {
    slug: 'cinematic',
    name: 'Cinematic',
    description:
      'Narrative-led and film-graded. Anamorphic framing, deliberate pacing, a scene rather than a clip.',
    category: 'CINEMATIC',
    sortOrder: 30,
  },
  {
    slug: 'celebration',
    name: 'Celebration',
    description:
      'Birthdays, engagements and milestones, treated with the production value of a title sequence.',
    category: 'CELEBRATION',
    sortOrder: 40,
  },
  {
    slug: 'travel',
    name: 'Travel',
    description:
      'Destination storytelling. Landscape, light and motion built around a single journey.',
    category: 'TRAVEL',
    sortOrder: 50,
  },
  {
    slug: 'executive',
    name: 'Executive',
    description:
      'Authority and composure for founders and leaders. Considered, restrained, boardroom-ready.',
    category: 'EXECUTIVE',
    sortOrder: 60,
  },
  {
    slug: 'social-media',
    name: 'Social Media',
    description:
      'Vertical-first and built to hold attention in the opening second, without losing craft.',
    category: 'SOCIAL_MEDIA',
    sortOrder: 70,
  },
  {
    slug: 'custom-concept',
    name: 'Custom Concept',
    description:
      'None of the above. Describe the film you have in mind and we will build the treatment around it.',
    category: 'BESPOKE',
    sortOrder: 80,
  },
] as const;

/** A catalogue entry that may or may not be backed by a database row. */
export interface ExperienceOption {
  /** NULL for a fallback entry, and for the Custom Concept path. */
  id: string | null;
  slug: string;
  name: string;
  description: string;
  category: ExperienceCategory;
  sortOrder: number;
}

export function toExperienceOption(row: VideoExperienceRow): ExperienceOption {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    sortOrder: row.sort_order,
  };
}

export function fallbackExperienceOptions(): ExperienceOption[] {
  return EXPERIENCE_DEFINITIONS.map((definition) => ({ id: null, ...definition }));
}

export const CUSTOM_CONCEPT_SLUG = 'custom-concept';
