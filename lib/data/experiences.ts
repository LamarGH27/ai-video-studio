import 'server-only';

import { isSupabaseConfigured } from '@/lib/env';
import { createPublicClient } from '@/lib/supabase/public';
import {
  fallbackExperienceOptions,
  toExperienceOption,
  type ExperienceOption,
} from '@/lib/catalog/experiences';

/**
 * Active experience catalogue.
 *
 * Reads video_experiences so the list can be curated commercially without a
 * deploy. Falls back to the typed definitions when Supabase is not configured
 * or unreachable, so the marketing pages never break on infrastructure.
 * A fallback option has `id: null` and cannot be submitted against — the
 * create flow resolves the slug to a real row server-side before writing.
 */
export async function listActiveExperiences(): Promise<ExperienceOption[]> {
  if (!isSupabaseConfigured()) return fallbackExperienceOptions();

  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from('video_experiences')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error || !data || data.length === 0) return fallbackExperienceOptions();
    return data.map(toExperienceOption);
  } catch {
    return fallbackExperienceOptions();
  }
}
