'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { CUSTOM_CONCEPT_SLUG } from '@/lib/catalog/experiences';
import { CONSENT_DEFINITIONS, CONSENT_WORDING_VERSION } from '@/lib/consent/definitions';
import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES_PER_PROJECT,
  MIN_REFERENCE_IMAGES_PER_PROJECT,
  REFERENCE_IMAGES_BUCKET,
  isAcceptedImageMimeType,
} from '@/lib/storage/config';
import {
  buildReferenceImagePath,
  isPathOwnedBy,
  sanitiseOriginalFilename,
} from '@/lib/storage/paths';
import {
  confirmUploadSchema,
  removeAssetSchema,
  saveDraftSchema,
  submitProjectSchema,
  type ConfirmUploadInput,
  type RemoveAssetInput,
  type SaveDraftInput,
  type SubmitProjectInput,
  type UploadSlotInput,
  uploadSlotSchema,
} from '@/lib/validation/project';
import type { ProjectRow } from '@/types/database';
import { fail, ok, type ActionResult } from './action-result';

/**
 * Server actions for the create-video flow.
 *
 * Rules every action here follows, without exception:
 *
 *   1. Identity comes from getSessionUser(). No action accepts a user id from
 *      the client, and none is present in any of the input schemas.
 *   2. Raw input is re-parsed with the Zod schema the browser also used. The
 *      browser having checked something is not evidence that it is true.
 *   3. Ownership and project state are re-read from the database before every
 *      write, and the write itself still passes through RLS. Two independent
 *      checks, not one.
 *   4. Storage paths are generated here, never derived from a filename.
 */

function fieldErrorsFrom(error: z.ZodError<unknown>): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

/**
 * Loads a project the caller owns and that is still editable.
 *
 * A project that belongs to someone else is invisible to this query because of
 * RLS, so it comes back as NOT_FOUND rather than FORBIDDEN — which is also the
 * right thing to tell the caller.
 */
async function loadOwnDraft(
  userId: string,
  projectId: string,
): Promise<
  { ok: true; project: ProjectRow } | { ok: false; code: 'NOT_FOUND' | 'CONFLICT'; message: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, code: 'NOT_FOUND', message: 'We could not find that project.' };
  }

  if (data.status !== 'DRAFT') {
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'This project has already been submitted and can no longer be edited.',
    };
  }

  return { ok: true, project: data };
}

/**
 * Step 1 + 2 — create or update the customer's draft project.
 *
 * Called when the customer leaves the brief step, because reference images need
 * a project id to be filed against. The row is created as a DRAFT and is not
 * visible to production staff until it is submitted.
 */
export async function saveDraftAction(
  input: SaveDraftInput,
): Promise<ActionResult<{ projectId: string; publicReference: string }>> {
  const user = await getSessionUser();
  if (!user) {
    return fail('UNAUTHENTICATED', 'Sign in to save your brief.');
  }

  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'Check the highlighted fields.', fieldErrorsFrom(parsed.error));
  }

  const values = parsed.data;
  const supabase = await createClient();

  // Resolve the slug to a real row rather than trusting a client-supplied id.
  const { data: experience } = await supabase
    .from('video_experiences')
    .select('id, slug')
    .eq('slug', values.experienceSlug)
    .eq('active', true)
    .maybeSingle();

  if (!experience && values.experienceSlug !== CUSTOM_CONCEPT_SLUG) {
    return fail('VALIDATION', 'That experience is no longer available. Choose another.', {
      experienceSlug: ['That experience is no longer available'],
    });
  }

  const writable = {
    experience_id: experience?.id ?? null,
    brief: values.brief,
    mood: values.mood,
    environment: values.environment,
    wardrobe_style: values.wardrobeStyle,
    orientation: values.orientation,
    desired_duration_seconds: values.desiredDurationSeconds,
    special_requirements: values.specialRequirements,
    preserve_requirements: values.preserveRequirements,
  };

  if (values.projectId) {
    const existing = await loadOwnDraft(user.id, values.projectId);
    if (!existing.ok) return fail(existing.code, existing.message);

    const { data, error } = await supabase
      .from('projects')
      .update(writable)
      .eq('id', values.projectId)
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .select('id, public_reference')
      .maybeSingle();

    if (error || !data) {
      return fail('ERROR', 'We could not save your brief. Try again.');
    }

    revalidatePath('/dashboard');
    return ok({ projectId: data.id, publicReference: data.public_reference });
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      // Ownership is set from the verified session, never from the request body.
      user_id: user.id,
      status: 'DRAFT',
      ...writable,
    })
    .select('id, public_reference')
    .maybeSingle();

  if (error || !data) {
    return fail('ERROR', 'We could not start your project. Try again.');
  }

  revalidatePath('/dashboard');
  return ok({ projectId: data.id, publicReference: data.public_reference });
}

/**
 * Step 3a — mint a one-shot signed upload URL for a single reference image.
 *
 * The browser uploads straight to Supabase Storage rather than through this
 * application. That keeps large files off the serverless request path (Vercel
 * caps a function request body at 4.5 MB) without giving the client any say
 * over where the object lands: the path is generated here from the session's
 * user id and the verified project id.
 */
export async function requestUploadSlotAction(
  input: UploadSlotInput,
): Promise<ActionResult<{ path: string; token: string }>> {
  const user = await getSessionUser();
  if (!user) {
    return fail('UNAUTHENTICATED', 'Sign in to upload reference images.');
  }

  const parsed = uploadSlotSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'That file cannot be uploaded.', fieldErrorsFrom(parsed.error));
  }

  const { projectId, mimeType } = parsed.data;

  const draft = await loadOwnDraft(user.id, projectId);
  if (!draft.ok) return fail(draft.code, draft.message);

  const supabase = await createClient();

  // Re-count server-side: the browser's idea of how many images exist is not
  // something to enforce a paid limit on.
  const { count, error: countError } = await supabase
    .from('project_assets')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('asset_type', 'REFERENCE_IMAGE');

  if (countError) {
    return fail('ERROR', 'We could not check your uploads. Try again.');
  }

  if ((count ?? 0) >= MAX_REFERENCE_IMAGES_PER_PROJECT) {
    return fail(
      'CONFLICT',
      `You can upload up to ${MAX_REFERENCE_IMAGES_PER_PROJECT} reference images.`,
    );
  }

  const path = buildReferenceImagePath({ userId: user.id, projectId, mimeType });

  const { data, error } = await supabase.storage
    .from(REFERENCE_IMAGES_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return fail('ERROR', 'We could not start that upload. Try again.');
  }

  return ok({ path: data.path, token: data.token });
}

/**
 * Step 3b — record an upload that has landed.
 *
 * The size and content type written to project_assets come from Storage's own
 * metadata, not from the browser's claims at slot-request time. If what actually
 * arrived breaks the upload policy, the object is deleted again rather than
 * being left orphaned in the bucket.
 */
export async function confirmUploadAction(input: ConfirmUploadInput): Promise<
  ActionResult<{
    assetId: string;
    storagePath: string;
    fileSize: number;
    mimeType: string;
    originalFilename: string;
  }>
> {
  const user = await getSessionUser();
  if (!user) {
    return fail('UNAUTHENTICATED', 'Sign in to upload reference images.');
  }

  const parsed = confirmUploadSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'That upload could not be recorded.', fieldErrorsFrom(parsed.error));
  }

  const { projectId, storagePath, originalFilename } = parsed.data;

  const draft = await loadOwnDraft(user.id, projectId);
  if (!draft.ok) return fail(draft.code, draft.message);

  // The client echoes back the path we issued. Confirm it is still one this user
  // and project could ever own before going near it.
  if (!isPathOwnedBy(storagePath, user.id) || !storagePath.startsWith(`${user.id}/${projectId}/`)) {
    return fail('FORBIDDEN', 'That upload does not belong to this project.');
  }

  const supabase = await createClient();

  const { data: info, error: infoError } = await supabase.storage
    .from(REFERENCE_IMAGES_BUCKET)
    .info(storagePath);

  if (infoError || !info) {
    return fail('NOT_FOUND', 'We could not find that upload. Try uploading it again.');
  }

  const actualSize = info.size ?? 0;
  const actualMimeType = info.contentType ?? '';

  const removeObject = async () => {
    await supabase.storage.from(REFERENCE_IMAGES_BUCKET).remove([storagePath]);
  };

  if (!isAcceptedImageMimeType(actualMimeType)) {
    await removeObject();
    return fail('VALIDATION', 'Reference images must be JPEG, PNG or WebP.');
  }

  if (actualSize <= 0 || actualSize > MAX_REFERENCE_IMAGE_BYTES) {
    await removeObject();
    const limitMb = Math.round(MAX_REFERENCE_IMAGE_BYTES / (1024 * 1024));
    return fail('VALIDATION', `Each image must be ${limitMb} MB or smaller.`);
  }

  const { data, error } = await supabase
    .from('project_assets')
    .insert({
      project_id: projectId,
      user_id: user.id,
      asset_type: 'REFERENCE_IMAGE',
      storage_bucket: REFERENCE_IMAGES_BUCKET,
      storage_path: storagePath,
      mime_type: actualMimeType,
      // Kept for support only. Sanitised, never used to build a path.
      original_filename: sanitiseOriginalFilename(originalFilename),
      file_size: actualSize,
    })
    .select('id, original_filename')
    .maybeSingle();

  if (error || !data) {
    await removeObject();
    return fail('ERROR', 'We could not record that upload. Try again.');
  }

  return ok({
    assetId: data.id,
    storagePath,
    fileSize: actualSize,
    mimeType: actualMimeType,
    originalFilename: data.original_filename ?? sanitiseOriginalFilename(originalFilename),
  });
}

/** Step 3c — remove a reference image the customer has changed their mind about. */
export async function removeAssetAction(input: RemoveAssetInput): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) {
    return fail('UNAUTHENTICATED', 'Sign in to manage your reference images.');
  }

  const parsed = removeAssetSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'That image could not be removed.');
  }

  const { projectId, assetId } = parsed.data;

  const draft = await loadOwnDraft(user.id, projectId);
  if (!draft.ok) return fail(draft.code, draft.message);

  const supabase = await createClient();

  const { data: asset } = await supabase
    .from('project_assets')
    .select('*')
    .eq('id', assetId)
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!asset) {
    return fail('NOT_FOUND', 'That image is no longer attached to this project.');
  }

  const { error } = await supabase
    .from('project_assets')
    .delete()
    .eq('id', assetId)
    .eq('user_id', user.id);

  if (error) {
    return fail('ERROR', 'We could not remove that image. Try again.');
  }

  // Delete the row first, then the object: an orphaned object is recoverable
  // housekeeping, a row pointing at a deleted object is a broken project page.
  await supabase.storage.from(asset.storage_bucket).remove([asset.storage_path]);

  return ok(undefined);
}

/**
 * Step 4 — record consent and submit the project.
 *
 * Consent is written as its own rows, with the wording version in force at the
 * time, before the status changes. If the consent write fails the project stays
 * a DRAFT, so there is never a submitted project without a consent record.
 */
export async function submitProjectAction(
  input: SubmitProjectInput,
): Promise<ActionResult<{ projectId: string; publicReference: string }>> {
  const user = await getSessionUser();
  if (!user) {
    return fail('UNAUTHENTICATED', 'Sign in to submit your project.');
  }

  const parsed = submitProjectSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      'VALIDATION',
      'Both required confirmations must be ticked before you can submit.',
      fieldErrorsFrom(parsed.error),
    );
  }

  const { projectId, hasLikenessPermission, aiProcessingConsent, portfolioPermission } =
    parsed.data;

  const draft = await loadOwnDraft(user.id, projectId);
  if (!draft.ok) return fail(draft.code, draft.message);

  const project = draft.project;

  if (!project.brief || !project.orientation) {
    return fail('VALIDATION', 'Your brief is incomplete. Go back and finish it.');
  }

  const supabase = await createClient();

  const { count, error: countError } = await supabase
    .from('project_assets')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('asset_type', 'REFERENCE_IMAGE');

  if (countError) {
    return fail('ERROR', 'We could not check your reference images. Try again.');
  }

  if ((count ?? 0) < MIN_REFERENCE_IMAGES_PER_PROJECT) {
    return fail(
      'VALIDATION',
      `Add at least ${MIN_REFERENCE_IMAGES_PER_PROJECT} reference image before submitting.`,
    );
  }

  const granted: Record<string, boolean> = {
    has_likeness_permission: hasLikenessPermission,
    ai_processing_consent: aiProcessingConsent,
    portfolio_permission: portfolioPermission,
  };

  const now = new Date().toISOString();

  const consentRows = CONSENT_DEFINITIONS.map((definition) => {
    const isGranted = granted[definition.field] === true;
    return {
      project_id: projectId,
      user_id: user.id,
      consent_type: definition.type,
      granted: isGranted,
      wording_version: CONSENT_WORDING_VERSION,
      granted_at: isGranted ? now : null,
    };
  });

  const { error: consentError } = await supabase
    .from('project_consents')
    .upsert(consentRows, { onConflict: 'project_id,consent_type' });

  if (consentError) {
    return fail('ERROR', 'We could not record your consent. Nothing has been submitted.');
  }

  // The status change is what makes the project visible to production staff, and
  // it is also what makes it read-only to the customer under RLS.
  const { data, error } = await supabase
    .from('projects')
    .update({ status: 'SUBMITTED', submitted_at: now })
    .eq('id', projectId)
    .eq('user_id', user.id)
    .eq('status', 'DRAFT')
    .select('id, public_reference')
    .maybeSingle();

  if (error || !data) {
    return fail('ERROR', 'We could not submit your project. Try again.');
  }

  revalidatePath('/dashboard');
  revalidatePath(`/dashboard/projects/${projectId}`);

  return ok({ projectId: data.id, publicReference: data.public_reference });
}
