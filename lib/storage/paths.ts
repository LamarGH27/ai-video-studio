import {
  isAcceptedDeliveryMimeType,
  isAcceptedImageMimeType,
  PROJECT_DELIVERIES_BUCKET,
  REFERENCE_IMAGES_BUCKET,
  type AcceptedDeliveryMimeType,
  type AcceptedImageMimeType,
  type DeliveryAssetType,
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

const DELIVERY_EXTENSION_BY_MIME: Record<AcceptedDeliveryMimeType, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export interface DeliveryPathInput {
  /** The CUSTOMER who owns the project — never the uploading administrator. */
  ownerId: string;
  projectId: string;
  assetType: DeliveryAssetType;
  /** 1-based delivery sequence. Appears in the name so objects are self-describing. */
  version: number;
  mimeType: string;
  /** Injectable for deterministic tests; defaults to crypto.randomUUID(). */
  objectId?: string;
}

/**
 * Object name for a preview or final video.
 *
 *     {owner_id}/{project_id}/{preview|final}-v{n}-{uuid}.{ext}
 *
 * The leading folder is the CUSTOMER's uid, not the admin's, for two reasons:
 * the customer's storage policy grants read on their own folder, and it keeps
 * everything belonging to one customer under one prefix.
 *
 * The version is in the name and the uuid makes it unique, so uploading
 * "Preview 2" can never overwrite "Preview 1" — even if the same administrator
 * uploads the same file twice in the same second.
 */
export function buildDeliveryPath({
  ownerId,
  projectId,
  assetType,
  version,
  mimeType,
  objectId,
}: DeliveryPathInput): string {
  if (!UUID_PATTERN.test(ownerId)) {
    throw new Error('buildDeliveryPath: ownerId must be a UUID');
  }
  if (!UUID_PATTERN.test(projectId)) {
    throw new Error('buildDeliveryPath: projectId must be a UUID');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('buildDeliveryPath: version must be a positive integer');
  }
  if (!isAcceptedDeliveryMimeType(mimeType)) {
    throw new Error(`Unsupported delivery MIME type: ${mimeType}`);
  }

  const id = objectId ?? crypto.randomUUID();
  if (!UUID_PATTERN.test(id)) {
    throw new Error('buildDeliveryPath: objectId must be a UUID');
  }

  const kind = assetType === 'PREVIEW_VIDEO' ? 'preview' : 'final';
  return `${ownerId}/${projectId}/${kind}-v${version}-${id}.${DELIVERY_EXTENSION_BY_MIME[mimeType]}`;
}

/** Guards against an asset row pointing anywhere other than the caller's own folder. */
export function isPathOwnedBy(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`);
}

export { PROJECT_DELIVERIES_BUCKET, REFERENCE_IMAGES_BUCKET };
