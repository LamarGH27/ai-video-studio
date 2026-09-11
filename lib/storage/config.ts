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
