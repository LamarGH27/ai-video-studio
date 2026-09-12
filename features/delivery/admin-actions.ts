'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
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

  // A preview belongs to production; a final belongs to finalising. Uploading
  // either at the wrong moment would strand the project in a state its workflow
  // does not describe.
  if (
    assetType === 'PREVIEW_VIDEO' &&
    !['IN_PRODUCTION', 'PREVIEW_READY'].includes(project.status)
  ) {
    return fail('CONFLICT', 'A preview can only be uploaded while the project is in production.');
  }
  if (assetType === 'FINAL_VIDEO' && project.status !== 'FINALISING') {
    return fail(
      'CONFLICT',
      'A final video can only be uploaded once the customer has approved a preview.',
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
 * come from Storage's own metadata, not from what the browser claimed. Anything
 * outside policy is deleted rather than left orphaned.
 *
 * Uploading a preview moves the project to PREVIEW_READY in the same action,
 * because a preview nobody is told about is not a delivery. The final video
 * does NOT auto-complete: the administrator confirms completion explicitly.
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

  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, status')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) {
    return fail('NOT_FOUND', 'That project no longer exists.');
  }

  // The client echoes back the path we issued. Confirm it is one this project
  // could ever own before going near it.
  if (!storagePath.startsWith(`${project.user_id}/${projectId}/`)) {
    return fail('FORBIDDEN', 'That upload does not belong to this project.');
  }

  const { data: info, error: infoError } = await supabase.storage
    .from(PROJECT_DELIVERIES_BUCKET)
    .info(storagePath);

  if (infoError || !info) {
    return fail('NOT_FOUND', 'We could not find that upload. Try uploading it again.');
  }

  const actualSize = info.size ?? 0;
  const actualMimeType = info.contentType ?? '';

  const removeObject = async () => {
    await supabase.storage.from(PROJECT_DELIVERIES_BUCKET).remove([storagePath]);
  };

  if (!isAcceptedDeliveryMimeType(actualMimeType)) {
    await removeObject();
    return fail('VALIDATION', 'Delivery videos must be MP4 or WebM.');
  }

  if (actualSize <= 0 || actualSize > MAX_DELIVERY_VIDEO_BYTES) {
    await removeObject();
    return fail('VALIDATION', `Each video must be ${MAX_DELIVERY_VIDEO_MB} MB or smaller.`);
  }

  const { data: asset, error } = await supabase
    .from('project_assets')
    .insert({
      project_id: projectId,
      // The CUSTOMER owns the asset row, not the uploading admin: it is what
      // their read policy keys on, and a database trigger enforces it.
      user_id: project.user_id,
      asset_type: assetType,
      storage_bucket: PROJECT_DELIVERIES_BUCKET,
      storage_path: storagePath,
      mime_type: actualMimeType,
      original_filename: sanitiseOriginalFilename(originalFilename),
      file_size: actualSize,
    })
    .select('id, version')
    .maybeSingle();

  if (error || !asset) {
    await removeObject();
    return fail('ERROR', 'We could not record that upload. Try again.');
  }

  let status = project.status;

  // A new preview is what makes a project ready for the customer to look at,
  // and it is what answers an open revision (a trigger resolves it).
  if (assetType === 'PREVIEW_VIDEO' && project.status === 'IN_PRODUCTION') {
    const { data: updated, error: transitionError } = await supabase
      .from('projects')
      .update({ status: 'PREVIEW_READY' })
      .eq('id', projectId)
      .eq('status', 'IN_PRODUCTION')
      .select('status')
      .maybeSingle();

    if (transitionError || !updated) {
      // The asset is recorded and valid; only the announcement failed. Leave it
      // in place and let the admin retry the transition rather than deleting a
      // perfectly good upload.
      return fail(
        'ERROR',
        'The preview was uploaded but the project could not be moved to Preview ready. Try the status control.',
      );
    }
    status = updated.status;
  }

  revalidatePath('/admin');
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}`);

  return ok({ assetId: asset.id, version: asset.version, status });
}
