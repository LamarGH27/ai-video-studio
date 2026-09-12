import { cn } from '@/lib/utils';
import type { DeliveryAsset } from '@/lib/data/deliveries';

/**
 * Plays a preview or final cut.
 *
 * The `src` is /api/deliveries/{assetId}, not a signed URL. That route
 * re-authorises on every request and redirects to a freshly signed, short-lived
 * URL, which means the page's HTML never contains a credential and nothing
 * expires while the customer is watching. `preload="metadata"` keeps the page
 * light until they press play.
 */
export function DeliveryVideoPlayer({
  asset,
  className,
  poster,
}: {
  asset: DeliveryAsset;
  className?: string;
  poster?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-panel border border-white/10 bg-black', className)}>
      <video
        controls
        preload="metadata"
        playsInline
        poster={poster}
        className="aspect-video w-full bg-black"
      >
        <source src={`/api/deliveries/${asset.id}`} type={asset.mimeType} />
        Your browser cannot play this video. Download it instead.
      </video>
    </div>
  );
}
