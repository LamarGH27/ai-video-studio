import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  ProjectAssetRow,
  ProjectConsentRow,
  ProjectRow,
  ProjectStatusHistoryRow,
  VideoExperienceRow,
} from '@/types/database';

export interface ProjectWithExperience extends ProjectRow {
  video_experiences: Pick<VideoExperienceRow, 'id' | 'slug' | 'name' | 'category'> | null;
}

export interface ProjectDetail {
  project: ProjectWithExperience;
  assets: ProjectAssetRow[];
  consents: ProjectConsentRow[];
  history: ProjectStatusHistoryRow[];
}

const PROJECT_SELECT = '*, video_experiences (id, slug, name, category)';

/**
 * All of the signed-in customer's projects.
 *
 * The `.eq('user_id', userId)` filter is redundant with the RLS policy on
 * purpose: the database is the enforcement point, the filter is a second lock
 * that would have to fail at the same time as the first.
 */
export async function listMyProjects(userId: string): Promise<ProjectWithExperience[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Could not load projects: ${error.message}`);
  return (data ?? []) as unknown as ProjectWithExperience[];
}

/**
 * One project belonging to the signed-in customer.
 *
 * Returns null — not someone else's row — when the id belongs to another
 * customer, because RLS filters it out before this code ever sees it. This is
 * what makes URL tampering on /dashboard/projects/[id] a dead end.
 */
export async function getMyProjectDetail(
  userId: string,
  projectId: string,
): Promise<ProjectDetail | null> {
  const supabase = await createClient();

  const { data: project, error } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !project) return null;

  const [assetsResult, consentsResult, historyResult] = await Promise.all([
    supabase
      .from('project_assets')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase.from('project_consents').select('*').eq('project_id', projectId),
    supabase
      .from('project_status_history')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ]);

  return {
    project: project as unknown as ProjectWithExperience,
    assets: assetsResult.data ?? [],
    consents: consentsResult.data ?? [],
    history: historyResult.data ?? [],
  };
}

/** The customer's current unsubmitted draft, if they left one behind. */
export async function getMyDraftProject(userId: string): Promise<ProjectRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'DRAFT')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

/**
 * Admin project queue.
 *
 * Runs as the signed-in admin, so the "admin can read all projects" RLS policy
 * is what grants the wider view. The caller must still have passed requireAdmin()
 * — RLS decides what is readable, the route guard decides who gets to ask.
 */
export async function listAllProjectsForAdmin(): Promise<ProjectWithExperience[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .neq('status', 'DRAFT')
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Could not load the project queue: ${error.message}`);
  return (data ?? []) as unknown as ProjectWithExperience[];
}

export async function getProjectDetailForAdmin(projectId: string): Promise<ProjectDetail | null> {
  const supabase = await createClient();

  const { data: project, error } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('id', projectId)
    .maybeSingle();

  if (error || !project) return null;

  const [assetsResult, consentsResult, historyResult] = await Promise.all([
    supabase
      .from('project_assets')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase.from('project_consents').select('*').eq('project_id', projectId),
    supabase
      .from('project_status_history')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ]);

  return {
    project: project as unknown as ProjectWithExperience,
    assets: assetsResult.data ?? [],
    consents: consentsResult.data ?? [],
    history: historyResult.data ?? [],
  };
}
