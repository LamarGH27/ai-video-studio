import 'server-only';

import { isSupabaseConfigured } from '@/lib/env';
import { createPublicClient } from '@/lib/supabase/public';
import type { ExperienceCategory } from '@/types/database';

/**
 * Portfolio content for the public showcase.
 *
 * Reads the publicly readable portfolio_items table. `experienceSlug` is what
 * makes "Create Your Version" work: a showcase piece links to the reusable
 * experience a visitor would pick to commission the same thing.
 *
 * The MVP seed has no media yet, so `thumbnailUrl` is normally null and the grid
 * renders a designed typographic placeholder. Customer reference images are
 * private and are never surfaced through this path.
 */
export interface PortfolioEntry {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: ExperienceCategory;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  featured: boolean;
  experienceSlug: string | null;
}

const FALLBACK_PORTFOLIO: readonly PortfolioEntry[] = [
  {
    id: 'monaco-summer',
    slug: 'monaco-summer',
    title: 'Monaco, Late Summer',
    description:
      'A walk through a berthed yacht at golden hour. Warm highlights, deep shadow, minimal movement.',
    category: 'LUXURY_LIFESTYLE',
    mediaUrl: null,
    thumbnailUrl: null,
    featured: true,
    experienceSlug: 'luxury-lifestyle',
  },
  {
    id: 'atelier-noir',
    slug: 'atelier-noir',
    title: 'Atelier Noir',
    description: 'Studio editorial in high contrast monochrome, cut to a single sustained rhythm.',
    category: 'FASHION',
    mediaUrl: null,
    thumbnailUrl: null,
    featured: true,
    experienceSlug: 'fashion',
  },
  {
    id: 'the-long-drive',
    slug: 'the-long-drive',
    title: 'The Long Drive',
    description:
      'Anamorphic night drive. Practical light, reflective surfaces, a film-grade finish.',
    category: 'CINEMATIC',
    mediaUrl: null,
    thumbnailUrl: null,
    featured: true,
    experienceSlug: 'cinematic',
  },
  {
    id: 'first-light-reel',
    slug: 'first-light-reel',
    title: 'First Light',
    description: 'Vertical social cut designed to land its subject inside the opening second.',
    category: 'SOCIAL_MEDIA',
    mediaUrl: null,
    thumbnailUrl: null,
    featured: false,
    experienceSlug: 'social-media',
  },
  {
    id: 'thirty-under-lights',
    slug: 'thirty-under-lights',
    title: 'Thirty, Under Lights',
    description: 'A milestone birthday treated as a title sequence rather than an event video.',
    category: 'CELEBRATION',
    mediaUrl: null,
    thumbnailUrl: null,
    featured: false,
    experienceSlug: 'celebration',
  },
  {
    id: 'kyoto-in-rain',
    slug: 'kyoto-in-rain',
    title: 'Kyoto In Rain',
    description: 'Destination piece built on reflection, texture and a restrained colour palette.',
    category: 'TRAVEL',
    mediaUrl: null,
    thumbnailUrl: null,
    featured: false,
    experienceSlug: 'travel',
  },
  {
    id: 'corner-office',
    slug: 'corner-office',
    title: 'Corner Office',
    description:
      'Founder portrait in motion. Composed framing, no gimmicks, built for a keynote open.',
    category: 'EXECUTIVE',
    mediaUrl: null,
    thumbnailUrl: null,
    featured: false,
    experienceSlug: 'executive',
  },
  {
    id: 'archive-no-4',
    slug: 'archive-no-4',
    title: 'Archive No. 4',
    description: 'A commissioned concept with no template behind it, developed from the brief up.',
    category: 'BESPOKE',
    mediaUrl: null,
    thumbnailUrl: null,
    featured: false,
    experienceSlug: 'custom-concept',
  },
] as const;

export async function listPortfolioEntries(): Promise<PortfolioEntry[]> {
  if (!isSupabaseConfigured()) return [...FALLBACK_PORTFOLIO];

  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('*, video_experiences(slug)')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) return [...FALLBACK_PORTFOLIO];

    return data.map((row) => {
      const experience = (row as { video_experiences?: { slug: string } | null }).video_experiences;
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        category: row.category,
        mediaUrl: row.media_url,
        thumbnailUrl: row.thumbnail_url,
        featured: row.featured,
        experienceSlug: experience?.slug ?? null,
      };
    });
  } catch {
    return [...FALLBACK_PORTFOLIO];
  }
}
