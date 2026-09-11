import { EMPTY_DRAFT, type DraftValues } from './types';

/**
 * Keeps the in-progress brief across an authentication detour.
 *
 * A visitor can fill in steps 1 and 2 before they have an account. When they
 * are sent to sign up, this is what stops them losing their work.
 *
 * sessionStorage, not localStorage: the brief is the customer's own creative
 * input and should not outlive the tab. Nothing sensitive is kept here — no
 * identifiers, no tokens, no image data.
 */
const STORAGE_KEY = 'avs:create-draft:v1';

export function readStoredDraft(): DraftValues | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftValues>;
    // Merged over the defaults so an older or truncated payload cannot produce
    // a half-built state object.
    return { ...EMPTY_DRAFT, ...parsed };
  } catch {
    return null;
  }
}

export function writeStoredDraft(values: DraftValues): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Private browsing or a full quota. The wizard still works in-memory.
  }
}

export function clearStoredDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
