import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { REFERENCE_IMAGES_BUCKET, SIGNED_URL_TTL_SECONDS } from '@/lib/storage/config';
import type { ProjectAssetRow } from '@/types/database';

export interface SignedAsset {
  id: string;
  storagePath: string;
  mimeType: string;
  originalFilename: string | null;
  fileSize: number;
  createdAt: string;
  /** Null when the signed URL could not be minted; the UI degrades to a placeholder. */
  signedUrl: string | null;
}

/**
 * Mints short-lived signed URLs for private reference images.
 *
 * This is the ONLY way customer photographs are displayed. The bucket is
 * private, so there is no public URL to fall back to, and the signing request
 * runs as the signed-in user — Storage RLS decides whether a URL is issued at
 * all. An admin gets URLs through the separate admin read policy.
 *
 * URLs expire (SIGNED_URL_TTL_SECONDS) and are generated per request, so they
 * are never cached in HTML that outlives them.
 */
export async function signReferenceImages(assets: ProjectAssetRow[]): Promise<SignedAsset[]> {
  const referenceImages = assets.filter((asset) => asset.asset_type === 'REFERENCE_IMAGE');
  if (referenceImages.length === 0) return [];

  const supabase = await createClient();
  const paths = referenceImages.map((asset) => asset.storage_path);

  const { data, error } = await supabase.storage
    .from(REFERENCE_IMAGES_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  const signedByPath = new Map<string, string>();
  if (!error && data) {
    for (const entry of data) {
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  return referenceImages.map((asset) => ({
    id: asset.id,
    storagePath: asset.storage_path,
    mimeType: asset.mime_type,
    originalFilename: asset.original_filename,
    fileSize: asset.file_size,
    createdAt: asset.created_at,
    signedUrl: signedByPath.get(asset.storage_path) ?? null,
  }));
}

export async function listReferenceImages(projectId: string): Promise<ProjectAssetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_assets')
    .select('*')
    .eq('project_id', projectId)
    .eq('asset_type', 'REFERENCE_IMAGE')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Could not load reference images: ${error.message}`);
  return data ?? [];
}

/**
 * Grace period before an unreferenced storage object is considered abandoned.
 *
 * An upload that has landed but whose confirmUploadAction is still in flight is
 * momentarily indistinguishable from an orphan. An hour is far longer than that
 * window and short enough that nothing lingers.
 */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/**
 * Deletes reference-image objects under this project that no asset row points at.
 *
 * WHY THESE EXIST
 * ---------------
 * Uploads go browser -> Storage directly, then the browser asks the server to
 * record what landed. Two things can break that second step:
 *
 *   1. the customer closes the tab (or loses connection) between the upload
 *      completing and confirmUploadAction running;
 *   2. a DRAFT project is deleted — project_assets rows cascade away, but
 *      storage.objects has no foreign key into public.projects, so the bytes
 *      stay behind.
 *
 * Case (1) is repaired here, at the natural moment: the next time the customer
 * opens the draft. No scheduler, no background worker, no new infrastructure.
 * Case (2) leaves nothing to reconcile against and is handled by the periodic
 * sweep documented in docs/architecture.md §7.
 *
 * Safety: this runs as the signed-in customer, so storage RLS confines it to
 * their own folder. It cannot touch another customer's media even if the
 * arguments were wrong. Objects inside the grace window are always left alone.
 */
export async function reconcileOrphanedReferenceImages(
  userId: string,
  projectId: string,
): Promise<number> {
  const supabase = await createClient();
  const prefix = `${userId}/${projectId}`;

  const { data: objects, error } = await supabase.storage
    .from(REFERENCE_IMAGES_BUCKET)
    .list(prefix, { limit: 100 });

  if (error || !objects || objects.length === 0) return 0;

  const { data: rows } = await supabase
    .from('project_assets')
    .select('storage_path')
    .eq('project_id', projectId)
    .eq('user_id', userId);

  const tracked = new Set((rows ?? []).map((row) => row.storage_path));
  const cutoff = Date.now() - ORPHAN_GRACE_MS;

  const orphans = objects
    .filter((object) => {
      if (tracked.has(`${prefix}/${object.name}`)) return false;
      const createdAt = object.created_at ? Date.parse(object.created_at) : Number.NaN;
      // Unknown age is treated as too recent to touch: never delete on a guess.
      return Number.isFinite(createdAt) && createdAt < cutoff;
    })
    .map((object) => `${prefix}/${object.name}`);

  if (orphans.length === 0) return 0;

  const { error: removeError } = await supabase.storage
    .from(REFERENCE_IMAGES_BUCKET)
    .remove(orphans);

  return removeError ? 0 : orphans.length;
}
