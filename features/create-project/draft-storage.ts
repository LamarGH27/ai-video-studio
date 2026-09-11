import { EMPTY_DRAFT, type DraftValues } from './types';

/**
 * Keeps an in-progress brief across the sign-up journey.
 *
 * WHY localStorage AND NOT sessionStorage
 * ---------------------------------------
 * A visitor can write their whole brief before they have an account. When they
 * reach the reference-image step they are sent to sign up, and if the Supabase
 * project has email confirmation enabled the journey continues like this:
 *
 *     /create  ->  /signup  ->  [email]  ->  /auth/confirm?next=/create  ->  /create
 *                                  ^
 *                       opened from a mail client
 *
 * That confirmation link is almost always opened in a NEW TAB. sessionStorage is
 * scoped to a single tab, so the new tab sees nothing and the customer loses
 * everything they wrote — at the exact moment they have just committed to an
 * account. localStorage is scoped to the origin and is shared across tabs, so
 * the returning tab finds the brief.
 *
 * WHAT THIS DELIBERATELY DOES NOT SOLVE
 * -------------------------------------
 * Confirming on a different device (signed up on a laptop, opened the email on a
 * phone). No browser-side store can cross devices, and solving it properly would
 * mean persisting an anonymous visitor's brief server-side — storing customer
 * creative input against no owner, with no one to delete it. The brief is still
 * safe on the original device, which is where the customer continues.
 *
 * Once the customer is authenticated the brief is promoted to a DRAFT project
 * row immediately (see wizard.tsx) and the server becomes the source of truth;
 * this copy is cleared at that point.
 *
 * WHAT IS STORED
 * --------------
 * Only the customer's own answers. No identifiers, no tokens, no image data.
 * Entries carry a schema version and expire, so an abandoned brief does not sit
 * in a shared browser indefinitely.
 */

const STORAGE_KEY = 'avs:create-draft';
const SCHEMA_VERSION = 2;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredDraft {
  version: number;
  savedAt: number;
  values: DraftValues;
}

/** Both stores are wrapped: access throws in some privacy modes. */
function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredDraft(): DraftValues | null {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredDraft>;

    // A payload from an older schema is discarded rather than half-applied.
    if (parsed.version !== SCHEMA_VERSION || typeof parsed.savedAt !== 'number') {
      store.removeItem(STORAGE_KEY);
      return null;
    }

    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      store.removeItem(STORAGE_KEY);
      return null;
    }

    if (!parsed.values || typeof parsed.values !== 'object') {
      store.removeItem(STORAGE_KEY);
      return null;
    }

    // Merged over the defaults so a truncated payload cannot produce a
    // half-built state object.
    return { ...EMPTY_DRAFT, ...parsed.values };
  } catch {
    // Corrupt JSON, or a store that throws on read. Start clean.
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      /* nothing further to do */
    }
    return null;
  }
}

export function writeStoredDraft(values: DraftValues): void {
  const store = storage();
  if (!store) return;

  // Nothing worth persisting yet — and this stops an empty entry overwriting a
  // real brief during the wizard's first render.
  if (!values.experienceSlug && values.brief.trim().length === 0) return;

  const payload: StoredDraft = { version: SCHEMA_VERSION, savedAt: Date.now(), values };

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded, or a private mode that refuses writes. The wizard keeps
    // working from memory; only the cross-tab handover is lost.
  }
}

export function clearStoredDraft(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
    // Remove the superseded sessionStorage key from before this changed, so a
    // returning visitor is not carrying a stale copy around.
    window.sessionStorage?.removeItem('avs:create-draft:v1');
  } catch {
    /* nothing further to do */
  }
}
