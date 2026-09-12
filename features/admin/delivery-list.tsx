import { DeliveryVideoPlayer } from '@/features/delivery/video-player';
import { formatDateTime, formatFileSize } from '@/lib/utils';
import type { DeliveryAsset } from '@/lib/data/deliveries';

/**
 * Every preview and final on a project, newest first.
 *
 * Old previews are kept deliberately: when a customer says "the third one was
 * better", support needs the third one to still exist.
 */
export function AdminDeliveryList({
  assets,
  title,
  emptyMessage,
}: {
  assets: readonly DeliveryAsset[];
  title: string;
  emptyMessage: string;
}) {
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-medium tracking-wide text-bone-400 uppercase">{title}</h3>

      {assets.length === 0 ? (
        <p className="mt-3 text-sm text-bone-400">{emptyMessage}</p>
      ) : (
        <ul className="mt-4 space-y-6">
          {assets.map((asset, index) => (
            <li key={asset.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-bone-100 text-sm">
                  {asset.assetType === 'FINAL_VIDEO' ? 'Final' : 'Preview'} {asset.version}
                  {index === 0 ? (
                    <span className="ml-2 text-xs text-brass-300">current</span>
                  ) : null}
                </p>
                <p className="text-xs text-bone-400/70">
                  {formatDateTime(asset.createdAt)} · {formatFileSize(asset.fileSize)}
                </p>
              </div>
              <DeliveryVideoPlayer asset={asset} className="mt-3" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
