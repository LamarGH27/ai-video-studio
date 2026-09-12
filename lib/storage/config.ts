/**
 * Upload policy for customer reference images.
 *
 * Every value here is enforced in three places, deliberately:
 *   1. the browser, for immediate feedback;
 *   2. the server action that mints the upload URL (the real check);
 *   3. the Supabase Storage bucket definition (the backstop).
 *
 * Uploaded media is untrusted input. The browser-reported MIME type is an
 * assertion, not a fact — it is re-checked against the object metadata Storage
 * records after the upload lands (see lib/data/assets.ts).
 */

export const REFERENCE_IMAGES_BUCKET = 'reference-images';

/** Reserved for future preview/final delivery. Nothing writes to it yet. */
export const PROJECT_DELIVERIES_BUCKET = 'project-deliveries';

export const ACCEPTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

/** Per-file ceiling. Keep at or below the bucket's file_size_limit. */
export const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export const MAX_REFERENCE_IMAGES_PER_PROJECT = 10;

export const MIN_REFERENCE_IMAGES_PER_PROJECT = 1;

/** How long a signed read URL for a private object stays valid. */
export const SIGNED_URL_TTL_SECONDS = 60 * 5;

/** `accept` attribute for the file input. */
export const IMAGE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_MIME_TYPES.join(',');

export function isAcceptedImageMimeType(value: string): value is AcceptedImageMimeType {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

// =============================================================================
// Delivery media (previews and finals)
// =============================================================================
// Same principles as reference images: a private bucket, generated object
// names, a server-authorised upload straight from the browser, verification
// against Storage's own metadata afterwards, and short-lived signed reads.

/**
 * Accepted delivery video types.
 *
 * QuickTime (`video/quicktime`, .mov) is deliberately NOT accepted even though
 * the bucket tolerates it. The customer watches the preview in an ordinary
 * `<video>` element, and .mov is only reliably playable in Safari — accepting
 * it would mean delivering previews that a large share of customers simply
 * cannot play. MP4 (H.264) and WebM cover every current browser. Convert on the
 * way out of the editing tool instead.
 */
export const ACCEPTED_DELIVERY_MIME_TYPES = ['video/mp4', 'video/webm'] as const;

export type AcceptedDeliveryMimeType = (typeof ACCEPTED_DELIVERY_MIME_TYPES)[number];

export const DELIVERY_ACCEPT_ATTRIBUTE = ACCEPTED_DELIVERY_MIME_TYPES.join(',');

export function isAcceptedDeliveryMimeType(value: string): value is AcceptedDeliveryMimeType {
  return (ACCEPTED_DELIVERY_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Per-file ceiling for a delivery video, in megabytes.
 *
 * Configured in ONE place and read from the environment so it can be raised
 * without a code change. The default is 50 MB because that is Supabase's own
 * default "global file size limit" for a project — picking anything larger by
 * default would produce uploads that fail at the storage layer on a fresh
 * project, for reasons invisible in this codebase.
 *
 * To raise it: increase the project's global limit (Storage → Settings), then
 * set NEXT_PUBLIC_MAX_DELIVERY_VIDEO_MB to match. The `project-deliveries`
 * bucket's own limit is the backstop above both. See docs/architecture.md §6.
 */
const DEFAULT_MAX_DELIVERY_VIDEO_MB = 50;

function readMaxDeliveryVideoMb(): number {
  const raw = Number(process.env.NEXT_PUBLIC_MAX_DELIVERY_VIDEO_MB);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_DELIVERY_VIDEO_MB;
  // Supabase caps a single non-resumable upload well below this; a value beyond
  // it would promise something the storage layer cannot honour.
  return Math.min(Math.floor(raw), 5000);
}

export const MAX_DELIVERY_VIDEO_MB = readMaxDeliveryVideoMb();

export const MAX_DELIVERY_VIDEO_BYTES = MAX_DELIVERY_VIDEO_MB * 1024 * 1024;

/**
 * Signed read TTL for delivery media.
 *
 * Longer than the 5 minutes used for reference thumbnails: a customer may watch
 * a two-minute film, scrub back through it, and the player must not 403
 * mid-playback. Still short enough that a leaked URL is worthless within the
 * hour.
 */
export const DELIVERY_SIGNED_URL_TTL_SECONDS = 60 * 30;

export type DeliveryAssetType = 'PREVIEW_VIDEO' | 'FINAL_VIDEO';

export function isDeliveryAssetType(value: string): value is DeliveryAssetType {
  return value === 'PREVIEW_VIDEO' || value === 'FINAL_VIDEO';
}
