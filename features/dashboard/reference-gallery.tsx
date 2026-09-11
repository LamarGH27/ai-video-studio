import { formatFileSize } from '@/lib/utils';
import type { SignedAsset } from '@/lib/data/assets';

/**
 * Thumbnails of the customer's own reference images.
 *
 * Every `src` is a short-lived signed URL minted for this request against a
 * private bucket. next/image is deliberately not used — it would proxy private
 * media through the image optimiser and cache it at the edge.
 */
export function ReferenceGallery({ assets }: { assets: readonly SignedAsset[] }) {
  if (assets.length === 0) {
    return <p className="text-sm text-bone-400">No reference images were attached.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {assets.map((asset) => (
        <li key={asset.id}>
          <div className="aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
            {asset.signedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.signedUrl}
                alt={`Reference image: ${asset.originalFilename ?? 'untitled'}`}
                className="size-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex size-full items-center justify-center px-3 text-center text-xs text-bone-400/60">
                Preview link expired. Refresh the page.
              </div>
            )}
          </div>
          <p
            className="mt-2 truncate text-xs text-bone-400"
            title={asset.originalFilename ?? undefined}
          >
            {asset.originalFilename ?? 'Reference image'}
          </p>
          <p className="text-xs text-bone-400/60">{formatFileSize(asset.fileSize)}</p>
        </li>
      ))}
    </ul>
  );
}
