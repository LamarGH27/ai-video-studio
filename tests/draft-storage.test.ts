/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredDraft,
  readStoredDraft,
  writeStoredDraft,
} from '@/features/create-project/draft-storage';
import { EMPTY_DRAFT, type DraftValues } from '@/features/create-project/types';

const STORAGE_KEY = 'avs:create-draft';

const brief: DraftValues = {
  ...EMPTY_DRAFT,
  experienceSlug: 'luxury-lifestyle',
  brief: 'A walk through a berthed yacht in Monaco at golden hour, confident and unhurried.',
  mood: 'Confident',
  orientation: 'VERTICAL_9_16',
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('draft persistence across the sign-up journey', () => {
  it('round-trips a brief', () => {
    writeStoredDraft(brief);
    expect(readStoredDraft()).toEqual(brief);
  });

  /**
   * The reason this module exists. The confirmation email is opened from a mail
   * client, which opens a new tab — and sessionStorage is per-tab, so a brief
   * kept there is gone at exactly the moment the customer has just signed up.
   */
  it('survives in localStorage, not sessionStorage, so a new tab can read it', () => {
    writeStoredDraft(brief);

    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    // A new tab starts with an empty sessionStorage but the same localStorage.
    window.sessionStorage.clear();
    expect(readStoredDraft()).toEqual(brief);
  });

  it('stores no identifiers, tokens or image data', () => {
    writeStoredDraft(brief);
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? '';
    const stored = JSON.parse(raw) as { values: Record<string, unknown> };

    expect(Object.keys(stored.values).sort()).toEqual(Object.keys(EMPTY_DRAFT).sort());
    expect(raw).not.toMatch(/token|user_id|userId|access|jwt|data:image/i);
  });

  it('does not persist an empty brief over a real one', () => {
    writeStoredDraft(brief);
    writeStoredDraft(EMPTY_DRAFT);
    expect(readStoredDraft()).toEqual(brief);
  });

  it('expires an abandoned brief after seven days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    writeStoredDraft(brief);

    vi.setSystemTime(new Date('2026-01-07T23:00:00Z'));
    expect(readStoredDraft()).toEqual(brief);

    vi.setSystemTime(new Date('2026-01-08T01:00:00Z'));
    expect(readStoredDraft()).toBeNull();
    // …and cleans up after itself rather than re-reading a dead entry.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards a payload written by an older schema', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, savedAt: Date.now(), values: brief }),
    );
    expect(readStoredDraft()).toBeNull();
  });

  it('discards corrupt JSON without throwing', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(() => readStoredDraft()).not.toThrow();
    expect(readStoredDraft()).toBeNull();
  });

  it('fills missing fields from the defaults rather than returning a partial state', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        values: { experienceSlug: 'fashion', brief: 'x'.repeat(50) },
      }),
    );

    const restored = readStoredDraft();
    expect(restored).not.toBeNull();
    expect(restored?.orientation).toBe(EMPTY_DRAFT.orientation);
    expect(restored?.desiredDurationSeconds).toBe(EMPTY_DRAFT.desiredDurationSeconds);
  });

  it('clears the brief, including a copy left by the superseded sessionStorage key', () => {
    writeStoredDraft(brief);
    window.sessionStorage.setItem('avs:create-draft:v1', JSON.stringify(brief));

    clearStoredDraft();

    expect(readStoredDraft()).toBeNull();
    expect(window.sessionStorage.getItem('avs:create-draft:v1')).toBeNull();
  });

  it('degrades quietly when storage is unavailable (private browsing)', () => {
    // Spy on Storage.prototype, not on the localStorage instance: jsdom backs
    // localStorage with a Proxy that resolves methods from the prototype, so an
    // instance-level spy is installed but never actually called.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => writeStoredDraft(brief)).not.toThrow();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => readStoredDraft()).not.toThrow();
    expect(readStoredDraft()).toBeNull();
    expect(() => clearStoredDraft()).not.toThrow();
  });
});
