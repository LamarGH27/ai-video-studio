import { z } from 'zod';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES_PER_PROJECT,
  MIN_REFERENCE_IMAGES_PER_PROJECT,
} from '@/lib/storage/config';

/**
 * Server-side schemas for the create-video flow.
 *
 * These provide immediate feedback and Server Action validation. Submission
 * requirements are also enforced authoritatively by the database RPC/triggers;
 * direct API callers cannot bypass them.
 *
 * Note what is absent: there is no `user_id` anywhere in these schemas. Ownership
 * is read from the session in the server action, never accepted from the client.
 */

const uuid = z.uuid('Expected a valid identifier');

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is limited to ${max} characters`)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null));

export const MIN_BRIEF_LENGTH = 40;
export const MAX_BRIEF_LENGTH = 4000;

export const orientationSchema = z.enum(['VERTICAL_9_16', 'LANDSCAPE_16_9', 'SQUARE_1_1']);

/** Step 1 — which experience the customer is buying. */
export const experienceStepSchema = z.object({
  experienceSlug: z
    .string()
    .trim()
    .min(1, 'Choose an experience')
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Choose an experience'),
});

export type ExperienceStepInput = z.infer<typeof experienceStepSchema>;

/** Step 2 — the creative brief. */
export const briefStepSchema = z.object({
  brief: z
    .string()
    .trim()
    .min(MIN_BRIEF_LENGTH, `Give us a bit more detail — at least ${MIN_BRIEF_LENGTH} characters`)
    .max(MAX_BRIEF_LENGTH, `Keep the brief under ${MAX_BRIEF_LENGTH} characters`),
  mood: optionalText(300, 'Mood'),
  environment: optionalText(300, 'Location'),
  wardrobeStyle: optionalText(300, 'Wardrobe'),
  orientation: orientationSchema,
  desiredDurationSeconds: z
    .number({ error: 'Choose an approximate length' })
    .int()
    .min(5, 'Minimum length is 5 seconds')
    .max(180, 'Maximum length is 180 seconds'),
  specialRequirements: optionalText(2000, 'Special requirements'),
  preserveRequirements: optionalText(2000, 'Things that must not change'),
});

export type BriefStepInput = z.infer<typeof briefStepSchema>;

/**
 * Client-side twin of briefStepSchema, used by React Hook Form.
 *
 * Identical limits, but without the `.transform()` calls that turn empty
 * strings into null — a resolver whose output type differs from its input type
 * fights the form's generics for no benefit. The server still re-parses with
 * briefStepSchema, which is the schema that decides what gets stored.
 */
export const briefFormSchema = z.object({
  brief: z
    .string()
    .trim()
    .min(MIN_BRIEF_LENGTH, `Give us a bit more detail — at least ${MIN_BRIEF_LENGTH} characters`)
    .max(MAX_BRIEF_LENGTH, `Keep the brief under ${MAX_BRIEF_LENGTH} characters`),
  mood: z.string().trim().max(300, 'Mood is limited to 300 characters'),
  environment: z.string().trim().max(300, 'Location is limited to 300 characters'),
  wardrobeStyle: z.string().trim().max(300, 'Wardrobe is limited to 300 characters'),
  orientation: orientationSchema,
  desiredDurationSeconds: z
    .number()
    .int()
    .min(5, 'Minimum length is 5 seconds')
    .max(180, 'Maximum length is 180 seconds'),
  specialRequirements: z.string().trim().max(2000, 'Limited to 2000 characters'),
  preserveRequirements: z.string().trim().max(2000, 'Limited to 2000 characters'),
});

export type BriefFormValues = z.infer<typeof briefFormSchema>;

/** Approximate lengths offered in the wizard. Free-form values are still valid. */
export const DURATION_PRESETS = [10, 15, 20, 30, 45, 60] as const;

/** Steps 1 + 2 together: everything needed to save a draft project. */
export const saveDraftSchema = experienceStepSchema.extend(briefStepSchema.shape).extend({
  /** Present when updating an existing draft; ownership is still re-checked server-side. */
  projectId: uuid.optional(),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

/** Step 3 — requesting a slot to upload one reference image. */
export const uploadSlotSchema = z.object({
  projectId: uuid,
  mimeType: z.enum(ACCEPTED_IMAGE_MIME_TYPES, {
    error: 'Upload a JPEG, PNG or WebP image',
  }),
  fileSize: z
    .number()
    .int()
    .positive('File appears to be empty')
    .max(
      MAX_REFERENCE_IMAGE_BYTES,
      `Each image must be ${Math.round(MAX_REFERENCE_IMAGE_BYTES / (1024 * 1024))} MB or smaller`,
    ),
  originalFilename: z.string().min(1).max(300),
});

export type UploadSlotInput = z.infer<typeof uploadSlotSchema>;

/** Step 3 — confirming an upload landed, so it can be recorded as an asset. */
export const confirmUploadSchema = z.object({
  projectId: uuid,
  storagePath: z.string().min(1).max(500),
  originalFilename: z.string().min(1).max(300),
});

export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;

export const removeAssetSchema = z.object({
  projectId: uuid,
  assetId: uuid,
});

export type RemoveAssetInput = z.infer<typeof removeAssetSchema>;

/**
 * Step 4 — consent.
 *
 * The two required consents are `z.literal(true)`: an unchecked box is a schema
 * failure, not a falsy value that slips through. Portfolio permission defaults
 * to false and is never pre-selected in the UI.
 */
export const consentStepSchema = z.object({
  hasLikenessPermission: z.literal(true, {
    error: 'This confirmation is required before we can start',
  }),
  aiProcessingConsent: z.literal(true, {
    error: 'This consent is required before we can process your images',
  }),
  portfolioPermission: z.boolean().default(false),
});

export type ConsentStepInput = z.infer<typeof consentStepSchema>;

export const submitProjectSchema = consentStepSchema.extend({
  projectId: uuid,
});

export type SubmitProjectInput = z.infer<typeof submitProjectSchema>;

export const REFERENCE_IMAGE_RULES = {
  min: MIN_REFERENCE_IMAGES_PER_PROJECT,
  max: MAX_REFERENCE_IMAGES_PER_PROJECT,
  maxBytes: MAX_REFERENCE_IMAGE_BYTES,
  acceptedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
} as const;

/** Shared by the client uploader and the server action, so limits cannot drift. */
export function validateImageCandidate(
  file: { type: string; size: number },
  existingCount: number,
): { ok: true } | { ok: false; message: string } {
  if (existingCount >= MAX_REFERENCE_IMAGES_PER_PROJECT) {
    return {
      ok: false,
      message: `You can upload up to ${MAX_REFERENCE_IMAGES_PER_PROJECT} images`,
    };
  }
  if (!(ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: 'Upload a JPEG, PNG or WebP image' };
  }
  if (file.size <= 0) {
    return { ok: false, message: 'That file appears to be empty' };
  }
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    const limitMb = Math.round(MAX_REFERENCE_IMAGE_BYTES / (1024 * 1024));
    return { ok: false, message: `Each image must be ${limitMb} MB or smaller` };
  }
  return { ok: true };
}
