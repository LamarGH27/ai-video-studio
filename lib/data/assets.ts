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
