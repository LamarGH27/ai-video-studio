import {
  isAcceptedImageMimeType,
  REFERENCE_IMAGES_BUCKET,
  type AcceptedImageMimeType,
} from './config';

/**
 * Storage object naming.
 *
 * Names are GENERATED, never taken from the upload. A client-supplied filename
 * can contain path traversal, null bytes, control characters or a misleading
 * double extension; none of that is allowed anywhere near an object key.
 *
 * The layout inside the private `reference-images` bucket is:
 *     {user_id}/{project_id}/{uuid}.{ext}
 * The leading folder is what the storage RLS policies check. That check — not
 * the shape of this string — is the security boundary.
 */

const EXTENSION_BY_MIME: Record<AcceptedImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export function extensionForMimeType(mimeType: string): string {
  if (!isAcceptedImageMimeType(mimeType)) {
    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
  return EXTENSION_BY_MIME[mimeType];
}

/**
 * Reduces an uploaded filename to something safe to persist for support
 * purposes. The result is stored in project_assets.original_filename and is
 * never used to build a storage path.
 */
export function sanitiseOriginalFilename(filename: string): string {
  const withoutDirectories = filename.split(/[/\\]/).pop() ?? '';
  const cleaned = withoutDirectories
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) return 'upload';
  return cleaned.slice(0, 120);
}

export interface ReferenceImagePathInput {
  userId: string;
  projectId: string;
  mimeType: string;
  /** Injectable for deterministic tests; defaults to crypto.randomUUID(). */
  objectId?: string;
}

export function buildReferenceImagePath({
  userId,
  projectId,
  mimeType,
  objectId,
}: ReferenceImagePathInput): string {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error('buildReferenceImagePath: userId must be a UUID');
  }
  if (!UUID_PATTERN.test(projectId)) {
    throw new Error('buildReferenceImagePath: projectId must be a UUID');
  }

  const id = objectId ?? crypto.randomUUID();
  if (!UUID_PATTERN.test(id)) {
    throw new Error('buildReferenceImagePath: objectId must be a UUID');
  }

  return `${userId}/${projectId}/${id}.${extensionForMimeType(mimeType)}`;
}

/** Guards against an asset row pointing anywhere other than the caller's own folder. */
export function isPathOwnedBy(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`);
}

export { REFERENCE_IMAGES_BUCKET };
