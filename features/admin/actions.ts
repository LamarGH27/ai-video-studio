'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { canAdminTransition, missingDeliveryFor } from '@/lib/projects/status';
import { updateProjectStatusSchema } from '@/lib/validation/admin';
import { fail, ok, type ActionResult } from '@/features/create-project/action-result';

/**
 * Change a project's production status.
 *
 * Three independent gates, in order:
 *   1. requireAdmin() — reads profiles.role from the database, not from a claim.
 *   2. canAdminTransition() — only the transitions the workflow actually allows,
 *      including the two that depend on a delivery existing rather than on the
 *      status alone.
 *   3. the "admin can update project status" RLS policy and
 *      enforce_project_status_transition(), which run regardless.
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

  // PREVIEW_READY and COMPLETED additionally require the delivery they
  // announce. The database enforces this; asking here turns what would be a
  // constraint violation reported as "we could not update that project" into a
  // sentence saying what is actually missing.
  const { data: deliveryRows } = await supabase
    .from('project_assets')
    .select('asset_type')
    .eq('project_id', projectId)
    .in('asset_type', ['PREVIEW_VIDEO', 'FINAL_VIDEO']);

  const deliveries = {
    hasPreview: (deliveryRows ?? []).some((row) => row.asset_type === 'PREVIEW_VIDEO'),
    hasFinal: (deliveryRows ?? []).some((row) => row.asset_type === 'FINAL_VIDEO'),
  };

  if (!canAdminTransition(project.status, status, deliveries)) {
    const missing = canAdminTransition(project.status, status, {
      hasPreview: true,
      hasFinal: true,
    })
      ? missingDeliveryFor(status)
      : null;

    return fail(
      'CONFLICT',
      missing ?? `A project cannot move from ${project.status} to ${status}.`,
    );
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
