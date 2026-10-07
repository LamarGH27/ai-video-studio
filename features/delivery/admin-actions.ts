'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { findConfirmedUpload } from '@/lib/data/upload-confirmation';
import type { ProjectAssetRow } from '@/types/database';
import { DELIVERY_UPLOAD_STATUS } from '@/lib/projects/status';
import {
  MAX_DELIVERY_VIDEO_BYTES,
  MAX_DELIVERY_VIDEO_MB,
  PROJECT_DELIVERIES_BUCKET,
  isAcceptedDeliveryMimeType,
} from '@/lib/storage/config';
import { buildDeliveryPath, sanitiseOriginalFilename } from '@/lib/storage/paths';
import {
  confirmDeliveryUploadSchema,
  deliveryUploadSlotSchema,
  type ConfirmDeliveryUploadInput,
  type DeliveryUploadSlotInput,
} from '@/lib/validation/delivery';
import { fail, ok, type ActionResult } from '@/features/create-project/action-result';

/**
 * Administrator delivery uploads.
 *
 * Production is manual: the video is produced outside this system and uploaded
 * here. These actions do the authorising, the naming and the verifying; the
 * bytes go browser -> Supabase Storage directly, exactly as reference images do
 * and for the same reason (a Vercel function body is capped far below a video).
 *
 * Every action runs as the signed-in administrator. There is no service-role
 * key: `requireAdmin()` reads profiles.role from the database, and the RLS
 * policy "project_assets: admin can add delivery assets" applies to the write
 * regardless.
 */

function fieldErrorsFrom(error: z.ZodError<unknown>): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

/**
 * Mints a one-shot signed upload URL for a preview or final video.
 *
 * The path is generated here from the PROJECT OWNER's id — not the
 * administrator's — so the object lands in the customer's folder, where their
 * own storage read policy can reach it. The version comes from the database, so
 * two uploads can never collide on a name and an earlier preview can never be
 * overwritten.
 */
export async function requestDeliveryUploadSlotAction(
  input: DeliveryUploadSlotInput,
): Promise<ActionResult<{ path: string; token: string }>> {
  await requireAdmin();

  const parsed = deliveryUploadSlotSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'That file cannot be uploaded.', fieldErrorsFrom(parsed.error));
  }

  const { projectId, assetType, mimeType } = parsed.data;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, status')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) {
    return fail('NOT_FOUND', 'That project no longer exists.');
  }

  // A preview belongs to production; a final belongs to finalising. This mirrors
  // the trigger enforce_delivery_asset_status(), which is what actually enforces
  // it — the check here exists so the administrator is told before they wait for
  // an upload, not because the rule is trusted to this layer. If the two ever
  // disagree the database wins, and the upload is simply rejected on confirm.
  //
  // PREVIEW_READY is deliberately NOT a status a preview may be uploaded in.
  // While the project is PREVIEW_READY the customer may be part-way through
  // deciding, and a replacement landing underneath them is the whole problem.
  // Rework goes back through IN_PRODUCTION, which the customer's revision
  // request is what opens.
  if (project.status !== DELIVERY_UPLOAD_STATUS[assetType]) {
    return fail(
      'CONFLICT',
      assetType === 'PREVIEW_VIDEO'
        ? 'A preview can only be uploaded while the project is in production.'
        : 'A final video can only be uploaded once the customer has approved a preview.',
    );
  }

  // Next version for this delivery type. The database assigns the authoritative
  // value on insert; this is only so the object name is self-describing.
  const { data: existing } = await supabase
    .from('project_assets')
    .select('version')
    .eq('project_id', projectId)
    .eq('asset_type', assetType)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (existing?.version ?? 0) + 1;

  const path = buildDeliveryPath({
    ownerId: project.user_id,
    projectId,
    assetType,
    version: nextVersion,
    mimeType,
  });

  const { data, error } = await supabase.storage
    .from(PROJECT_DELIVERIES_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return fail('ERROR', 'We could not start that upload. Try again.');
  }

  return ok({ path: data.path, token: data.token });
}

/**
 * Records a delivery upload that has landed, then advances the project.
 *
 * As with reference images, the size and content type written to the database
 * come from Storage's own metadata, not from what the browser claimed. Objects
 * are retained on failure: a concurrent or ambiguously acknowledged transaction
 * may already reference them. Cleanup must establish orphanhood separately.
 *
 * The recording itself is a single database function so that creating the asset
 * and announcing it are one transaction holding one lock on the project row —
 * see record_delivery_asset() in migration 000600. A preview nobody is told
 * about is not a delivery. The final video does NOT auto-complete: the
 * administrator confirms completion explicitly.
 */
export async function confirmDeliveryUploadAction(
  input: ConfirmDeliveryUploadInput,
): Promise<ActionResult<{ assetId: string; version: number; status: string }>> {
  await requireAdmin();

  const parsed = confirmDeliveryUploadSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'That upload could not be recorded.', fieldErrorsFrom(parsed.error));
  }

  const { projectId, assetType, storagePath, originalFilename } = parsed.data;
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, user_id, status')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError) return fail('ERROR', 'We could not check that project. Try again.');
  if (!project) {
    return fail('NOT_FOUND', 'That project no longer exists.');
  }

  // The client echoes back the path we issued. Confirm it is one this project
  // could ever own before going near it.
  if (!storagePath.startsWith(`${project.user_id}/${projectId}/`)) {
    return fail('FORBIDDEN', 'That upload does not belong to this project.');
  }

  const lookup = () =>
    findConfirmedUpload(supabase, {
      bucket: PROJECT_DELIVERIES_BUCKET,
      path: storagePath,
      projectId,
      userId: project.user_id,
      assetType,
    });
  const replay = async (
    asset: ProjectAssetRow,
  ): Promise<ActionResult<{ assetId: string; version: number; status: string }>> => {
    // A successful preview write advances the project in the same transaction.
    // Re-read rather than return the status observed before a lost response.
    const { data: current, error } = await supabase
      .from('projects')
      .select('status')
      .eq('id', projectId)
      .maybeSingle();
    if (error || !current)
      return fail('ERROR', 'We could not check the project status. Try again.');
    revalidatePath('/admin');
    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/dashboard/projects/${projectId}`);
    return ok({ assetId: asset.id, version: asset.version, status: current.status });
  };

  const existing = await lookup();
  if (existing.kind === 'found') return replay(existing.asset);
  if (existing.kind === 'error') return fail('ERROR', 'We could not check that upload. Try again.');
  if (existing.kind === 'conflict')
    return fail('CONFLICT', 'That upload is already recorded elsewhere.');

  // Replays are allowed above, but a new asset must still belong to this stage.
  if (project.status !== DELIVERY_UPLOAD_STATUS[assetType]) {
    return fail('CONFLICT', 'The project moved on while that was uploading. Reload and try again.');
  }

  const { data: info, error: infoError } = await supabase.storage
    .from(PROJECT_DELIVERIES_BUCKET)
    .info(storagePath);

  if (infoError || !info) {
    return fail('NOT_FOUND', 'We could not find that upload. Try uploading it again.');
  }

  const actualSize = info.size ?? 0;
  const actualMimeType = info.contentType ?? '';

  if (!isAcceptedDeliveryMimeType(actualMimeType)) {
    return fail('VALIDATION', 'Delivery videos must be MP4 or WebM.');
  }

  if (actualSize <= 0 || actualSize > MAX_DELIVERY_VIDEO_BYTES) {
    return fail('VALIDATION', `Each video must be ${MAX_DELIVERY_VIDEO_MB} MB or smaller.`);
  }

  // One call, one transaction, one lock. record_delivery_asset() takes the
  // project row FOR UPDATE, re-checks the status against that locked row,
  // inserts the asset and — for a preview — moves the project to PREVIEW_READY.
  // Doing this as an insert followed by an update would be two transactions with
  // a gap between them, in which a preview exists against a project nobody has
  // been told about.
  //
  // The values it is given are the ones Storage reported, not the ones the
  // browser claimed, and it re-derives the owner and the version itself.
  let recorded: { assetId: string; version: number; status: string } | null = null;
  let failureMessage = '';
  try {
    const { data, error } = await supabase.rpc('record_delivery_asset', {
      p_project_id: projectId,
      p_asset_type: assetType,
      p_storage_path: storagePath,
      p_mime_type: actualMimeType,
      p_original_filename: sanitiseOriginalFilename(originalFilename),
      p_file_size: actualSize,
    });
    if (!error) recorded = data;
    failureMessage = error?.message ?? '';
  } catch {
    // The response can be lost after the database transaction commits.
  }

  if (!recorded) {
    const recovered = await lookup();
    if (recovered.kind === 'found') return replay(recovered.asset);
    if (recovered.kind === 'conflict')
      return fail('CONFLICT', 'That upload is already recorded elsewhere.');
    const workflowConflict = /in production|approved a preview/i.test(failureMessage);
    return fail(
      workflowConflict ? 'CONFLICT' : 'ERROR',
      workflowConflict
        ? 'The project moved on while that was uploading. Reload and try again.'
        : 'We could not record that upload. Try again.',
    );
  }

  const { assetId, version, status } = recorded;

  revalidatePath('/admin');
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}`);

  return ok({ assetId, version, status });
}
