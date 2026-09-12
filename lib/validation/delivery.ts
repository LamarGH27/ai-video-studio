import { z } from 'zod';
import {
  ACCEPTED_DELIVERY_MIME_TYPES,
  MAX_DELIVERY_VIDEO_BYTES,
  MAX_DELIVERY_VIDEO_MB,
} from '@/lib/storage/config';

/**
 * Server-side schemas for preview and final delivery.
 *
 * Same rules as the create flow: these are the authority, the browser's checks
 * are a convenience, and no schema here has a `user_id` — ownership comes from
 * the session and the project row, never from the request.
 */

const uuid = z.uuid('Expected a valid identifier');

export const deliveryAssetTypeSchema = z.enum(['PREVIEW_VIDEO', 'FINAL_VIDEO']);

/** Admin: request a signed slot to upload one delivery video. */
export const deliveryUploadSlotSchema = z.object({
  projectId: uuid,
  assetType: deliveryAssetTypeSchema,
  mimeType: z.enum(ACCEPTED_DELIVERY_MIME_TYPES, {
    error: 'Upload an MP4 or WebM video',
  }),
  fileSize: z
    .number()
    .int()
    .positive('That file appears to be empty')
    .max(MAX_DELIVERY_VIDEO_BYTES, `Each video must be ${MAX_DELIVERY_VIDEO_MB} MB or smaller`),
  originalFilename: z.string().min(1).max(300),
});

export type DeliveryUploadSlotInput = z.infer<typeof deliveryUploadSlotSchema>;

/** Admin: record a delivery upload that has landed. */
export const confirmDeliveryUploadSchema = z.object({
  projectId: uuid,
  assetType: deliveryAssetTypeSchema,
  storagePath: z.string().min(1).max(500),
  originalFilename: z.string().min(1).max(300),
});

export type ConfirmDeliveryUploadInput = z.infer<typeof confirmDeliveryUploadSchema>;

/** Customer: approve the latest preview. */
export const approvePreviewSchema = z.object({ projectId: uuid });

export type ApprovePreviewInput = z.infer<typeof approvePreviewSchema>;

export const MIN_REVISION_MESSAGE_LENGTH = 20;
export const MAX_REVISION_MESSAGE_LENGTH = 2000;

/**
 * Customer: request a revision.
 *
 * The bounds match the CHECK constraint on project_revisions.message and the
 * validation inside request_project_revision(), so a message rejected here
 * would have been rejected by the database too — the schema exists to say so
 * in the customer's language rather than as a constraint violation.
 */
export const requestRevisionSchema = z.object({
  projectId: uuid,
  message: z
    .string()
    .trim()
    .min(
      MIN_REVISION_MESSAGE_LENGTH,
      `Tell us a little more — at least ${MIN_REVISION_MESSAGE_LENGTH} characters`,
    )
    .max(MAX_REVISION_MESSAGE_LENGTH, `Keep it under ${MAX_REVISION_MESSAGE_LENGTH} characters`),
});

export type RequestRevisionInput = z.infer<typeof requestRevisionSchema>;

/** Shared by the admin uploader and the server action, so the limits cannot drift. */
export function validateDeliveryCandidate(file: {
  type: string;
  size: number;
}): { ok: true } | { ok: false; message: string } {
  if (!(ACCEPTED_DELIVERY_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: 'Upload an MP4 or WebM video' };
  }
  if (file.size <= 0) {
    return { ok: false, message: 'That file appears to be empty' };
  }
  if (file.size > MAX_DELIVERY_VIDEO_BYTES) {
    return { ok: false, message: `Each video must be ${MAX_DELIVERY_VIDEO_MB} MB or smaller` };
  }
  return { ok: true };
}
