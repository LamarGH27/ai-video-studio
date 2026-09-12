import 'server-only';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser, getProfile } from '@/lib/auth/session';
import {
  DELIVERY_SIGNED_URL_TTL_SECONDS,
  PROJECT_DELIVERIES_BUCKET,
  isDeliveryAssetType,
  type DeliveryAssetType,
} from '@/lib/storage/config';
import type { ProjectAssetRow, ProjectRow } from '@/types/database';

const assetIdSchema = z.uuid();

export interface DeliveryAsset {
  id: string;
  assetType: DeliveryAssetType;
  version: number;
  mimeType: string;
  fileSize: number;
  originalFilename: string | null;
  storagePath: string;
  createdAt: string;
}

export interface AuthorisedDeliveryAsset {
  asset: ProjectAssetRow;
  project: Pick<ProjectRow, 'id' | 'user_id' | 'status' | 'public_reference'>;
  isOwner: boolean;
  isAdmin: boolean;
}

/**
 * The authorisation chain for a single piece of delivery media.
 *
 * An asset id arriving from a URL is untrusted input, and "it looks like a UUID
 * and the row exists" is not authorisation. Every step below is checked
 * explicitly, in order, and any failure returns null — the same null, so that
 * probing cannot distinguish "no such asset" from "not yours":
 *
 *   1. there is an authenticated caller;
 *   2. the id is well formed;
 *   3. the asset row exists (RLS has already filtered other customers' rows);
 *   4. the parent project exists and is readable;
 *   5. the caller owns that project, or is an administrator;
 *   6. the asset really belongs to that project;
 *   7. the asset's denormalised owner matches the project's owner.
 *
 * Steps 3 and 4 already pass through Row Level Security, so 5–7 are a second,
 * independent lock rather than the only one. A signed URL is minted only after
 * all seven hold.
 */
export async function authoriseDeliveryAsset(
  assetId: string,
): Promise<AuthorisedDeliveryAsset | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const parsed = assetIdSchema.safeParse(assetId);
  if (!parsed.success) return null;

  const supabase = await createClient();

  const { data: asset } = await supabase
    .from('project_assets')
    .select('*')
    .eq('id', parsed.data)
    .maybeSingle();

  if (!asset) return null;
  if (!isDeliveryAssetType(asset.asset_type)) return null;

  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, status, public_reference')
    .eq('id', asset.project_id)
    .maybeSingle();

  if (!project) return null;

  const profile = await getProfile();
  const isAdmin = profile?.role === 'admin';
  const isOwner = project.user_id === user.id;

  if (!isOwner && !isAdmin) return null;

  // The asset must belong to the project we just authorised, and its
  // denormalised owner must agree with that project's owner. Both are
  // guaranteed by database triggers; re-checking here means a future change to
  // either would surface as a refusal rather than as a leak.
  if (asset.project_id !== project.id) return null;
  if (asset.user_id !== project.user_id) return null;

  return { asset, project, isOwner, isAdmin };
}

/**
 * Mints a short-lived signed URL for an authorised delivery asset.
 *
 * The bucket is private, so there is no public URL to fall back to. Pass
 * `downloadAs` to have Storage set Content-Disposition, which is what turns the
 * customer's "Download Final Video" into a download rather than a navigation.
 */
export async function signDeliveryAsset(
  asset: Pick<ProjectAssetRow, 'storage_bucket' | 'storage_path'>,
  options: { downloadAs?: string } = {},
): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(asset.storage_bucket)
    .createSignedUrl(
      asset.storage_path,
      DELIVERY_SIGNED_URL_TTL_SECONDS,
      options.downloadAs ? { download: options.downloadAs } : undefined,
    );

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function toDeliveryAsset(row: ProjectAssetRow): DeliveryAsset | null {
  if (!isDeliveryAssetType(row.asset_type)) return null;
  return {
    id: row.id,
    assetType: row.asset_type,
    version: row.version,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    originalFilename: row.original_filename,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  };
}

/**
 * Delivery media for a project, newest version first.
 *
 * Runs as the caller, so RLS decides visibility: a customer sees their own, an
 * admin sees any, and anyone else sees an empty list.
 */
export async function listDeliveryAssets(projectId: string): Promise<DeliveryAsset[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_assets')
    .select('*')
    .eq('project_id', projectId)
    .in('asset_type', ['PREVIEW_VIDEO', 'FINAL_VIDEO'])
    .order('version', { ascending: false });

  if (error || !data) return [];
  return data.map(toDeliveryAsset).filter((asset): asset is DeliveryAsset => asset !== null);
}

export function latestOfType(
  assets: readonly DeliveryAsset[],
  assetType: DeliveryAssetType,
): DeliveryAsset | null {
  return assets.filter((asset) => asset.assetType === assetType)[0] ?? null;
}

export { PROJECT_DELIVERIES_BUCKET };
