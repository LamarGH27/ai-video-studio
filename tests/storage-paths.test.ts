import { describe, expect, it } from 'vitest';
import {
  buildReferenceImagePath,
  extensionForMimeType,
  isPathOwnedBy,
  sanitiseOriginalFilename,
} from '@/lib/storage/paths';

const USER_ID = '11111111-2222-4333-8444-555555555555';
const PROJECT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const OBJECT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

describe('buildReferenceImagePath', () => {
  it('files the object under the owner and project, with a generated name', () => {
    const path = buildReferenceImagePath({
      userId: USER_ID,
      projectId: PROJECT_ID,
      mimeType: 'image/jpeg',
      objectId: OBJECT_ID,
    });

    expect(path).toBe(`${USER_ID}/${PROJECT_ID}/${OBJECT_ID}.jpg`);
  });

  it('derives the extension from the MIME type, not from any filename', () => {
    const png = buildReferenceImagePath({
      userId: USER_ID,
      projectId: PROJECT_ID,
      mimeType: 'image/png',
      objectId: OBJECT_ID,
    });
    const webp = buildReferenceImagePath({
      userId: USER_ID,
      projectId: PROJECT_ID,
      mimeType: 'image/webp',
      objectId: OBJECT_ID,
    });

    expect(png.endsWith('.png')).toBe(true);
    expect(webp.endsWith('.webp')).toBe(true);
  });

  it('rejects a MIME type outside the upload policy', () => {
    expect(() =>
      buildReferenceImagePath({
        userId: USER_ID,
        projectId: PROJECT_ID,
        mimeType: 'image/svg+xml',
        objectId: OBJECT_ID,
      }),
    ).toThrow(/Unsupported MIME type/);

    expect(() => extensionForMimeType('application/x-msdownload')).toThrow();
  });

  // A non-UUID owner segment would break the storage RLS policy, which compares
  // the first path segment against auth.uid().
  it('refuses identifiers that are not UUIDs', () => {
    expect(() =>
      buildReferenceImagePath({
        userId: '../../etc',
        projectId: PROJECT_ID,
        mimeType: 'image/jpeg',
      }),
    ).toThrow(/userId must be a UUID/);

    expect(() =>
      buildReferenceImagePath({
        userId: USER_ID,
        projectId: 'not-a-uuid',
        mimeType: 'image/jpeg',
      }),
    ).toThrow(/projectId must be a UUID/);
  });

  it('generates a distinct name per call', () => {
    const first = buildReferenceImagePath({
      userId: USER_ID,
      projectId: PROJECT_ID,
      mimeType: 'image/jpeg',
    });
    const second = buildReferenceImagePath({
      userId: USER_ID,
      projectId: PROJECT_ID,
      mimeType: 'image/jpeg',
    });

    expect(first).not.toBe(second);
  });
});

describe('sanitiseOriginalFilename', () => {
  it('strips directory components so no path can be smuggled through', () => {
    expect(sanitiseOriginalFilename('../../../etc/passwd')).toBe('passwd');
    expect(sanitiseOriginalFilename('C:\\Users\\me\\holiday.jpg')).toBe('holiday.jpg');
    expect(sanitiseOriginalFilename('nested/folder/photo.png')).toBe('photo.png');
  });

  it('removes control characters, including a null byte', () => {
    expect(sanitiseOriginalFilename('photo\u0000.jpg')).toBe('photo.jpg');
    expect(sanitiseOriginalFilename('ph\u001boto.png')).toBe('photo.png');
  });

  it('collapses repeated dots that could disguise an extension', () => {
    expect(sanitiseOriginalFilename('photo..jpg')).toBe('photo.jpg');
    expect(sanitiseOriginalFilename('..hidden.png')).toBe('hidden.png');
  });

  it('replaces characters outside the safe set', () => {
    expect(sanitiseOriginalFilename('sh;rm -rf$.jpg')).toBe('sh_rm -rf_.jpg');
  });

  it('falls back to a placeholder rather than returning an empty name', () => {
    expect(sanitiseOriginalFilename('')).toBe('upload');
    expect(sanitiseOriginalFilename('...')).toBe('upload');
    expect(sanitiseOriginalFilename('/')).toBe('upload');
  });

  it('caps the stored length', () => {
    expect(sanitiseOriginalFilename(`${'a'.repeat(500)}.jpg`)).toHaveLength(120);
  });
});

describe('isPathOwnedBy', () => {
  it('accepts only paths inside the caller’s own folder', () => {
    expect(isPathOwnedBy(`${USER_ID}/${PROJECT_ID}/x.jpg`, USER_ID)).toBe(true);
    expect(isPathOwnedBy(`${PROJECT_ID}/${USER_ID}/x.jpg`, USER_ID)).toBe(false);
    // A prefix match must not be enough.
    expect(isPathOwnedBy(`${USER_ID}-other/x.jpg`, USER_ID)).toBe(false);
  });
});
