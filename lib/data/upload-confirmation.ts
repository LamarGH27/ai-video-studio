import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { ProjectAssetRow } from '@/types/database';

type LookupResult =
  { kind: 'found'; asset: ProjectAssetRow } | { kind: 'missing' | 'error' | 'conflict' };

/** A storage object is the retry identity. Never trust a match from another context. */
export async function findConfirmedUpload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  expected: {
    bucket: string;
    path: string;
    projectId: string;
    userId: string;
    assetType: ProjectAssetRow['asset_type'];
  },
): Promise<LookupResult> {
  try {
    const { data: asset, error } = await supabase
      .from('project_assets')
      .select('*')
      .eq('storage_bucket', expected.bucket)
      .eq('storage_path', expected.path)
      .maybeSingle();

    if (error) return { kind: 'error' };
    if (!asset) return { kind: 'missing' };
    if (
      asset.project_id !== expected.projectId ||
      asset.user_id !== expected.userId ||
      asset.asset_type !== expected.assetType
    ) {
      return { kind: 'conflict' };
    }
    return { kind: 'found', asset };
  } catch {
    return { kind: 'error' };
  }
}
