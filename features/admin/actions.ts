'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { canAdminTransition } from '@/lib/projects/status';
import { updateProjectStatusSchema } from '@/lib/validation/admin';
import { fail, ok, type ActionResult } from '@/features/create-project/action-result';

/**
 * Change a project's production status.
 *
 * Three independent gates, in order:
 *   1. requireAdmin() — reads profiles.role from the database, not from a claim.
 *   2. canAdminTransition() — only the transitions the workflow actually allows.
 *   3. the "admin can update project status" RLS policy, which runs regardless.
 *
 * This deliberately runs as the signed-in admin rather than with the service-role
 * key: RLS still applies, and project_status_history records who made the change
 * because auth.uid() is the admin's id.
 */
export async function updateProjectStatusAction(input: {
  projectId: string;
  status: string;
}): Promise<ActionResult> {
  await requireAdmin();

  const parsed = updateProjectStatusSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'That is not a valid status.');
  }

  const { projectId, status } = parsed.data;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, status')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) {
    return fail('NOT_FOUND', 'That project no longer exists.');
  }

  if (!canAdminTransition(project.status, status)) {
    return fail('CONFLICT', `A project cannot move from ${project.status} to ${status}.`);
  }

  const { error } = await supabase.from('projects').update({ status }).eq('id', projectId);

  if (error) {
    return fail('ERROR', 'We could not update that project.');
  }

  revalidatePath('/admin');
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}`);

  return ok(undefined);
}
