/**
 * The notification model, as TypeScript sees it.
 *
 * The authority for all of this is migration 000700: the triggers decide what
 * is enqueued, the dedupe key is a UNIQUE column, and the retry schedule is a
 * SQL function. Everything here is a mirror — needed to render and to test, but
 * never the thing that enforces anything.
 *
 * tests/notification-events.test.ts parses the migration and fails if the two
 * disagree, the same arrangement that keeps lib/projects/status.ts honest.
 */

export const NOTIFICATION_EVENT_TYPES = [
  'PROJECT_SUBMITTED_CUSTOMER',
  'PROJECT_SUBMITTED_ADMIN',
  'PREVIEW_READY_CUSTOMER',
  'PREVIEW_REVISED_CUSTOMER',
  'REVISION_REQUESTED_ADMIN',
  'PREVIEW_APPROVED_CUSTOMER',
  'PREVIEW_APPROVED_ADMIN',
  'FINAL_VIDEO_READY_CUSTOMER',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export type NotificationRecipient = 'CUSTOMER' | 'ADMIN';

/** Who each event is addressed to. Used to resolve the recipient at send time. */
export const EVENT_RECIPIENT: Readonly<Record<NotificationEventType, NotificationRecipient>> = {
  PROJECT_SUBMITTED_CUSTOMER: 'CUSTOMER',
  PROJECT_SUBMITTED_ADMIN: 'ADMIN',
  PREVIEW_READY_CUSTOMER: 'CUSTOMER',
  PREVIEW_REVISED_CUSTOMER: 'CUSTOMER',
  REVISION_REQUESTED_ADMIN: 'ADMIN',
  PREVIEW_APPROVED_CUSTOMER: 'CUSTOMER',
  PREVIEW_APPROVED_ADMIN: 'ADMIN',
  FINAL_VIDEO_READY_CUSTOMER: 'CUSTOMER',
} as const;

export function isNotificationEventType(value: string): value is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Dedupe keys, mirroring the format() calls in the triggers.
 *
 * These exist so tests can assert the exact shape the database will produce
 * without hand-writing the string twice. Nothing in the application enqueues,
 * so nothing in the application builds one of these at runtime.
 */
export const dedupeKey = {
  projectSubmitted: (projectId: string, recipient: NotificationRecipient) =>
    `project:${projectId}:submitted:${recipient.toLowerCase()}`,
  previewReady: (projectId: string, previewAssetId: string) =>
    `project:${projectId}:preview:${previewAssetId}:ready`,
  revisionRequested: (projectId: string, revisionId: string) =>
    `project:${projectId}:revision:${revisionId}:admin`,
  previewApproved: (projectId: string, approvalId: string, recipient: NotificationRecipient) =>
    `project:${projectId}:approval:${approvalId}:${recipient.toLowerCase()}`,
  projectCompleted: (projectId: string) => `project:${projectId}:completed:customer`,
} as const;

/**
 * Bounded retry. Mirrors notification_retry_delay() and
 * notification_max_attempts() in migration 000700.
 *
 * Bounded matters: an address that does not exist will not start existing, and
 * a queue that retries forever turns one bad row into a permanent load on the
 * provider — which is how a small failure becomes a rate limit for everyone.
 */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

const RETRY_DELAYS_MS: readonly number[] = [
  60_000, // after attempt 1
  5 * 60_000, // after attempt 2
  30 * 60_000, // after attempt 3
  2 * 60 * 60_000, // after attempt 4
];

/**
 * How long to wait after `attempt` has failed, or null when the budget is spent.
 * `attempt` is 1-based and is the attempt that just failed.
 */
export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) return null;
  return RETRY_DELAYS_MS[attempt - 1] ?? null;
}

/** A row whose attempts are exhausted: an operator has to decide, not the worker. */
export function isPermanentlyFailed(row: {
  status: NotificationStatus;
  attempt_count: number;
  next_attempt_at: string | null;
}): boolean {
  return row.status === 'FAILED' && row.next_attempt_at === null;
}
