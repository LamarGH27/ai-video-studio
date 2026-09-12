import { describe, expect, it } from 'vitest';
import { buildDeliveryPath } from '@/lib/storage/paths';
import {
  MAX_DELIVERY_VIDEO_BYTES,
  MAX_DELIVERY_VIDEO_MB,
  ACCEPTED_DELIVERY_MIME_TYPES,
  isAcceptedDeliveryMimeType,
  isDeliveryAssetType,
} from '@/lib/storage/config';
import {
  approvePreviewSchema,
  confirmDeliveryUploadSchema,
  deliveryUploadSlotSchema,
  requestRevisionSchema,
  validateDeliveryCandidate,
  MIN_REVISION_MESSAGE_LENGTH,
  MAX_REVISION_MESSAGE_LENGTH,
} from '@/lib/validation/delivery';

const OWNER = '11111111-2222-4333-8444-555555555555';
const PROJECT = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const OBJECT = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

describe('delivery upload policy', () => {
  it('accepts only the types every current browser can play', () => {
    expect([...ACCEPTED_DELIVERY_MIME_TYPES]).toEqual(['video/mp4', 'video/webm']);
    // QuickTime is tolerated by the bucket but refused by the application: a
    // .mov preview is unplayable outside Safari, so accepting it would deliver
    // previews a large share of customers simply could not watch.
    expect(isAcceptedDeliveryMimeType('video/quicktime')).toBe(false);
    expect(isAcceptedDeliveryMimeType('image/jpeg')).toBe(false);
  });

  it('reads its size ceiling from one configurable place', () => {
    expect(MAX_DELIVERY_VIDEO_BYTES).toBe(MAX_DELIVERY_VIDEO_MB * 1024 * 1024);
    expect(MAX_DELIVERY_VIDEO_MB).toBeGreaterThan(0);
  });

  it('refuses oversize, empty and wrongly typed files', () => {
    expect(validateDeliveryCandidate({ type: 'video/mp4', size: 1024 })).toEqual({ ok: true });
    expect(validateDeliveryCandidate({ type: 'video/mp4', size: 0 }).ok).toBe(false);
    expect(
      validateDeliveryCandidate({ type: 'video/mp4', size: MAX_DELIVERY_VIDEO_BYTES + 1 }).ok,
    ).toBe(false);
    expect(validateDeliveryCandidate({ type: 'video/quicktime', size: 1024 }).ok).toBe(false);
    expect(validateDeliveryCandidate({ type: 'text/html', size: 1024 }).ok).toBe(false);
  });

  it('recognises only the two delivery asset types', () => {
    expect(isDeliveryAssetType('PREVIEW_VIDEO')).toBe(true);
    expect(isDeliveryAssetType('FINAL_VIDEO')).toBe(true);
    expect(isDeliveryAssetType('REFERENCE_IMAGE')).toBe(false);
  });
});

describe('buildDeliveryPath', () => {
  it('files the object under the CUSTOMER, not the uploading admin', () => {
    const path = buildDeliveryPath({
      ownerId: OWNER,
      projectId: PROJECT,
      assetType: 'PREVIEW_VIDEO',
      version: 1,
      mimeType: 'video/mp4',
      objectId: OBJECT,
    });
    // The leading segment is what the customer's storage read policy checks.
    expect(path).toBe(`${OWNER}/${PROJECT}/preview-v1-${OBJECT}.mp4`);
    expect(path.startsWith(`${OWNER}/`)).toBe(true);
  });

  it('names finals distinctly and carries the version', () => {
    const path = buildDeliveryPath({
      ownerId: OWNER,
      projectId: PROJECT,
      assetType: 'FINAL_VIDEO',
      version: 3,
      mimeType: 'video/webm',
      objectId: OBJECT,
    });
    expect(path).toBe(`${OWNER}/${PROJECT}/final-v3-${OBJECT}.webm`);
  });

  /** A new preview must never land on the object an earlier one occupies. */
  it('cannot collide with an earlier delivery', () => {
    const first = buildDeliveryPath({
      ownerId: OWNER,
      projectId: PROJECT,
      assetType: 'PREVIEW_VIDEO',
      version: 1,
      mimeType: 'video/mp4',
    });
    const second = buildDeliveryPath({
      ownerId: OWNER,
      projectId: PROJECT,
      assetType: 'PREVIEW_VIDEO',
      version: 2,
      mimeType: 'video/mp4',
    });
    const sameVersionAgain = buildDeliveryPath({
      ownerId: OWNER,
      projectId: PROJECT,
      assetType: 'PREVIEW_VIDEO',
      version: 1,
      mimeType: 'video/mp4',
    });

    expect(first).not.toBe(second);
    // Even the same version twice gets a distinct object: the uuid, not the
    // version, is what guarantees nothing is overwritten.
    expect(first).not.toBe(sameVersionAgain);
  });

  it('rejects identifiers and versions that could break the storage policy', () => {
    expect(() =>
      buildDeliveryPath({
        ownerId: '../../etc',
        projectId: PROJECT,
        assetType: 'PREVIEW_VIDEO',
        version: 1,
        mimeType: 'video/mp4',
      }),
    ).toThrow(/ownerId must be a UUID/);

    expect(() =>
      buildDeliveryPath({
        ownerId: OWNER,
        projectId: 'not-a-uuid',
        assetType: 'PREVIEW_VIDEO',
        version: 1,
        mimeType: 'video/mp4',
      }),
    ).toThrow(/projectId must be a UUID/);

    expect(() =>
      buildDeliveryPath({
        ownerId: OWNER,
        projectId: PROJECT,
        assetType: 'PREVIEW_VIDEO',
        version: 0,
        mimeType: 'video/mp4',
      }),
    ).toThrow(/version must be a positive integer/);

    expect(() =>
      buildDeliveryPath({
        ownerId: OWNER,
        projectId: PROJECT,
        assetType: 'PREVIEW_VIDEO',
        version: 1,
        mimeType: 'video/quicktime',
      }),
    ).toThrow(/Unsupported delivery MIME type/);
  });
});

describe('delivery schemas', () => {
  const slot = {
    projectId: PROJECT,
    assetType: 'PREVIEW_VIDEO' as const,
    mimeType: 'video/mp4' as const,
    fileSize: 1024,
    originalFilename: 'preview.mp4',
  };

  it('accepts a valid upload slot request', () => {
    expect(deliveryUploadSlotSchema.safeParse(slot).success).toBe(true);
  });

  it('has no user_id for a client to supply', () => {
    const result = deliveryUploadSlotSchema.safeParse({ ...slot, user_id: 'someone-else' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('user_id');
  });

  it('rejects an unsupported type, an oversize file and a bad asset type', () => {
    expect(
      deliveryUploadSlotSchema.safeParse({ ...slot, mimeType: 'video/quicktime' }).success,
    ).toBe(false);
    expect(
      deliveryUploadSlotSchema.safeParse({ ...slot, fileSize: MAX_DELIVERY_VIDEO_BYTES + 1 })
        .success,
    ).toBe(false);
    expect(
      deliveryUploadSlotSchema.safeParse({ ...slot, assetType: 'REFERENCE_IMAGE' }).success,
    ).toBe(false);
  });

  it('requires a UUID project on confirmation', () => {
    expect(
      confirmDeliveryUploadSchema.safeParse({
        projectId: 'x',
        assetType: 'FINAL_VIDEO',
        storagePath: 'a/b/c.mp4',
        originalFilename: 'c.mp4',
      }).success,
    ).toBe(false);
  });
});

describe('revision request schema', () => {
  const valid = {
    projectId: PROJECT,
    previewAssetId: OBJECT,
    message: 'Please hold a beat longer at the railing before the camera moves on.',
  };

  it('accepts a specific request', () => {
    expect(requestRevisionSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * Both customer decisions name the preview they are about. The database is
   * what refuses a superseded one, but the id has to survive the schema to
   * reach it — a decision that arrives without one is not a decision about
   * anything, so it is rejected here rather than defaulting to "the latest".
   */
  it('requires the preview being responded to', () => {
    const { previewAssetId: _omitted, ...withoutPreview } = valid;
    expect(requestRevisionSchema.safeParse(withoutPreview).success).toBe(false);
    expect(
      requestRevisionSchema.safeParse({ ...valid, previewAssetId: 'not-a-uuid' }).success,
    ).toBe(false);

    const { previewAssetId: _also, ...approvalWithoutPreview } = { ...valid };
    expect(approvePreviewSchema.safeParse(approvalWithoutPreview).success).toBe(false);
    expect(
      approvePreviewSchema.safeParse({ projectId: PROJECT, previewAssetId: OBJECT }).success,
    ).toBe(true);
  });

  /**
   * These bounds also exist as a CHECK constraint on project_revisions.message
   * and inside request_project_revision(). The schema exists to say so in the
   * customer's language, not to be the only place it is true.
   */
  it('mirrors the database bounds exactly', () => {
    expect(MIN_REVISION_MESSAGE_LENGTH).toBe(20);
    expect(MAX_REVISION_MESSAGE_LENGTH).toBe(2000);

    expect(requestRevisionSchema.safeParse({ ...valid, message: 'a'.repeat(19) }).success).toBe(
      false,
    );
    expect(requestRevisionSchema.safeParse({ ...valid, message: 'a'.repeat(20) }).success).toBe(
      true,
    );
    expect(requestRevisionSchema.safeParse({ ...valid, message: 'a'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('does not accept whitespace as a request', () => {
    expect(requestRevisionSchema.safeParse({ ...valid, message: '   '.repeat(20) }).success).toBe(
      false,
    );
  });
});
