'use client';

import { useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { REFERENCE_IMAGES_BUCKET } from '@/lib/storage/config';
import { validateImageCandidate } from '@/lib/validation/project';
import { confirmUploadAction, removeAssetAction, requestUploadSlotAction } from './actions';
import type { UploadedAsset } from './types';

/**
 * Browser-side upload of reference images.
 *
 * Per file:
 *   1. cheap local checks, so obviously invalid files never leave the device;
 *   2. requestUploadSlotAction — the server validates, generates the object path
 *      and returns a one-shot signed upload token;
 *   3. uploadToSignedUrl — the bytes go straight to private Supabase Storage,
 *      never through this application's servers;
 *   4. confirmUploadAction — the server reads the object's real size and content
 *      type back from Storage and records the asset row.
 *
 * The local checks in step 1 are a convenience. Steps 2 and 4 are the enforcement.
 */
export function useReferenceUploads({
  projectId,
  assets,
  setAssets,
  onUnauthenticated,
}: {
  projectId: string | null;
  assets: readonly UploadedAsset[];
  setAssets: (updater: (previous: UploadedAsset[]) => UploadedAsset[]) => void;
  onUnauthenticated: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      if (!projectId) {
        setUploadErrors(['Save your brief before uploading images.']);
        return;
      }

      const files = Array.from(fileList);
      const errors: string[] = [];
      setUploadErrors([]);
      setUploading(true);

      const supabase = createClient();

      // Sequential, not parallel: the per-project image cap is counted
      // server-side on each request, and racing requests would fight over it.
      let runningCount = assets.length;

      for (const file of files) {
        const candidate = validateImageCandidate(file, runningCount);
        if (!candidate.ok) {
          errors.push(`${file.name}: ${candidate.message}`);
          continue;
        }

        const slot = await requestUploadSlotAction({
          projectId,
          mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
          fileSize: file.size,
          originalFilename: file.name,
        });

        if (!slot.ok) {
          if (slot.code === 'UNAUTHENTICATED') {
            onUnauthenticated();
            break;
          }
          errors.push(`${file.name}: ${slot.message}`);
          continue;
        }

        const { error: uploadError } = await supabase.storage
          .from(REFERENCE_IMAGES_BUCKET)
          .uploadToSignedUrl(slot.data.path, slot.data.token, file, {
            contentType: file.type,
          });

        if (uploadError) {
          errors.push(`${file.name}: upload failed. Try again.`);
          continue;
        }

        const confirmed = await confirmUploadAction({
          projectId,
          storagePath: slot.data.path,
          originalFilename: file.name,
        });

        if (!confirmed.ok) {
          errors.push(`${file.name}: ${confirmed.message}`);
          continue;
        }

        runningCount += 1;

        // A local object URL avoids a round trip for a signed URL on an image
        // the browser already holds. Revoked when the asset is removed.
        const previewUrl = URL.createObjectURL(file);

        setAssets((previous) => [
          ...previous,
          {
            assetId: confirmed.data.assetId,
            storagePath: confirmed.data.storagePath,
            originalFilename: confirmed.data.originalFilename,
            fileSize: confirmed.data.fileSize,
            mimeType: confirmed.data.mimeType,
            previewUrl,
          },
        ]);
      }

      setUploadErrors(errors);
      setUploading(false);
    },
    [projectId, assets.length, setAssets, onUnauthenticated],
  );

  const removeAsset = useCallback(
    async (assetId: string) => {
      if (!projectId) return;

      const target = assets.find((asset) => asset.assetId === assetId);

      const result = await removeAssetAction({ projectId, assetId });
      if (!result.ok) {
        if (result.code === 'UNAUTHENTICATED') {
          onUnauthenticated();
          return;
        }
        setUploadErrors([result.message]);
        return;
      }

      if (target?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }

      setAssets((previous) => previous.filter((asset) => asset.assetId !== assetId));
    },
    [projectId, assets, setAssets, onUnauthenticated],
  );

  return { uploading, uploadErrors, uploadFiles, removeAsset };
}
