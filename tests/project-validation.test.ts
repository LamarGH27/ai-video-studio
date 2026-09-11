import { describe, expect, it } from 'vitest';
import {
  briefStepSchema,
  confirmUploadSchema,
  consentStepSchema,
  saveDraftSchema,
  submitProjectSchema,
  uploadSlotSchema,
  validateImageCandidate,
} from '@/lib/validation/project';
import { MAX_REFERENCE_IMAGE_BYTES, MAX_REFERENCE_IMAGES_PER_PROJECT } from '@/lib/storage/config';

const VALID_BRIEF =
  'I want to walk through a luxury yacht in Monaco wearing an elegant summer outfit.';
const UUID = '11111111-2222-4333-8444-555555555555';

const validBrief = {
  brief: VALID_BRIEF,
  orientation: 'VERTICAL_9_16' as const,
  desiredDurationSeconds: 15,
};

describe('briefStepSchema', () => {
  it('accepts a complete brief', () => {
    expect(briefStepSchema.safeParse(validBrief).success).toBe(true);
  });

  it('requires enough detail to be worth producing', () => {
    expect(briefStepSchema.safeParse({ ...validBrief, brief: 'Make it nice' }).success).toBe(false);
  });

  it('normalises blank optional fields to null rather than empty strings', () => {
    const result = briefStepSchema.safeParse({ ...validBrief, mood: '   ', environment: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mood).toBeNull();
      expect(result.data.environment).toBeNull();
    }
  });

  it('rejects an orientation that is not one of the three offered', () => {
    expect(briefStepSchema.safeParse({ ...validBrief, orientation: 'PORTRAIT' }).success).toBe(
      false,
    );
  });

  it('rejects a duration outside the supported range', () => {
    expect(briefStepSchema.safeParse({ ...validBrief, desiredDurationSeconds: 600 }).success).toBe(
      false,
    );
    expect(briefStepSchema.safeParse({ ...validBrief, desiredDurationSeconds: 1 }).success).toBe(
      false,
    );
  });
});

describe('saveDraftSchema', () => {
  // Ownership is derived from the session. A user_id in the payload must not be
  // able to influence what gets written.
  it('has no user_id field for a client to supply', () => {
    const result = saveDraftSchema.safeParse({
      ...validBrief,
      experienceSlug: 'fashion',
      user_id: 'someone-else',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('user_id');
  });

  it('rejects an experience slug that is not slug-shaped', () => {
    expect(
      saveDraftSchema.safeParse({ ...validBrief, experienceSlug: '../../admin' }).success,
    ).toBe(false);
    expect(saveDraftSchema.safeParse({ ...validBrief, experienceSlug: '' }).success).toBe(false);
  });
});

describe('consentStepSchema', () => {
  it('accepts only an explicit true for each required consent', () => {
    const result = consentStepSchema.safeParse({
      hasLikenessPermission: true,
      aiProcessingConsent: true,
      portfolioPermission: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unticked required consent', () => {
    expect(
      consentStepSchema.safeParse({
        hasLikenessPermission: false,
        aiProcessingConsent: true,
        portfolioPermission: false,
      }).success,
    ).toBe(false);

    expect(
      consentStepSchema.safeParse({
        hasLikenessPermission: true,
        aiProcessingConsent: false,
        portfolioPermission: false,
      }).success,
    ).toBe(false);
  });

  it('defaults the optional portfolio permission to false when absent', () => {
    const result = consentStepSchema.safeParse({
      hasLikenessPermission: true,
      aiProcessingConsent: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.portfolioPermission).toBe(false);
  });

  it('does not accept a truthy non-boolean in place of consent', () => {
    expect(
      consentStepSchema.safeParse({
        hasLikenessPermission: 'yes',
        aiProcessingConsent: 1,
        portfolioPermission: false,
      }).success,
    ).toBe(false);
  });
});

describe('submitProjectSchema', () => {
  it('requires a real project identifier alongside consent', () => {
    expect(
      submitProjectSchema.safeParse({
        projectId: 'not-a-uuid',
        hasLikenessPermission: true,
        aiProcessingConsent: true,
        portfolioPermission: false,
      }).success,
    ).toBe(false);

    expect(
      submitProjectSchema.safeParse({
        projectId: UUID,
        hasLikenessPermission: true,
        aiProcessingConsent: true,
        portfolioPermission: false,
      }).success,
    ).toBe(true);
  });
});

describe('uploadSlotSchema', () => {
  const valid = {
    projectId: UUID,
    mimeType: 'image/jpeg' as const,
    fileSize: 1024,
    originalFilename: 'photo.jpg',
  };

  it('accepts an image inside the policy', () => {
    expect(uploadSlotSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a MIME type outside the allowlist', () => {
    expect(uploadSlotSchema.safeParse({ ...valid, mimeType: 'image/gif' }).success).toBe(false);
    expect(uploadSlotSchema.safeParse({ ...valid, mimeType: 'text/html' }).success).toBe(false);
  });

  it('rejects a file above the size ceiling and an empty one', () => {
    expect(
      uploadSlotSchema.safeParse({ ...valid, fileSize: MAX_REFERENCE_IMAGE_BYTES + 1 }).success,
    ).toBe(false);
    expect(uploadSlotSchema.safeParse({ ...valid, fileSize: 0 }).success).toBe(false);
  });
});

describe('confirmUploadSchema', () => {
  it('requires a project identifier that is a UUID', () => {
    expect(
      confirmUploadSchema.safeParse({
        projectId: 'x',
        storagePath: 'a/b/c.jpg',
        originalFilename: 'c.jpg',
      }).success,
    ).toBe(false);
  });
});

describe('validateImageCandidate', () => {
  it('accepts a supported image below the limits', () => {
    expect(validateImageCandidate({ type: 'image/png', size: 2048 }, 0)).toEqual({ ok: true });
  });

  it('refuses an unsupported type', () => {
    const result = validateImageCandidate({ type: 'application/pdf', size: 2048 }, 0);
    expect(result.ok).toBe(false);
  });

  it('refuses a file over the size ceiling', () => {
    const result = validateImageCandidate(
      { type: 'image/jpeg', size: MAX_REFERENCE_IMAGE_BYTES + 1 },
      0,
    );
    expect(result.ok).toBe(false);
  });

  it('refuses once the per-project image cap is reached', () => {
    const result = validateImageCandidate(
      { type: 'image/jpeg', size: 2048 },
      MAX_REFERENCE_IMAGES_PER_PROJECT,
    );
    expect(result.ok).toBe(false);
  });

  it('refuses an empty file', () => {
    expect(validateImageCandidate({ type: 'image/jpeg', size: 0 }, 0).ok).toBe(false);
  });
});
