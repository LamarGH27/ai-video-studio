import 'server-only';

import { createWorkerClient } from '@/lib/supabase/worker';
import { siteUrl } from '@/lib/env';
import { adminNotificationRecipients } from '@/lib/notifications/config';
import { isNotificationEventType, EVENT_RECIPIENT } from '@/lib/notifications/events';
import { resolveEmailProvider } from '@/lib/notifications/providers';
import { redactSecrets, type EmailProvider } from '@/lib/notifications/provider';
import {
  withDeadline,
  PROVIDER_TIMEOUT_MS,
  DATABASE_TIMEOUT_MS,
  WORKER_BUDGET_MS,
} from '@/lib/notifications/deadline';
import { renderNotificationEmail } from '@/lib/notifications/templates';
import type { NotificationOutboxRow } from '@/types/database';

/** Claims commit before provider calls. Claim one row at a time so queued work
 * cannot consume its lease while an earlier delivery is still running. */
export interface ProcessResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  provider: string;
  acknowledgementErrors: number;
  budgetExhausted: boolean;
}

/** The three database calls the worker makes. Narrow on purpose: it is also
 *  the seam tests substitute, so a test cannot accidentally exercise more of
 *  the database surface than the worker itself is allowed to touch. */
export interface NotificationStore {
  claim(limit: number, leaseSeconds: number): Promise<NotificationOutboxRow[]>;
  markSent(id: string, claimToken: string, providerMessageId: string | null): Promise<void>;
  markFailed(id: string, claimToken: string, error: string, permanent: boolean): Promise<void>;
}

export interface ProcessOptions {
  limit?: number;
  leaseSeconds?: number;
  /** Injected by tests. Production resolves from the environment. */
  provider?: EmailProvider;
  /** Injected by tests. Production uses the worker's Supabase client. */
  store?: NotificationStore;
}

const DEFAULT_BATCH = 20;
const DEFAULT_LEASE_SECONDS = 300;

function supabaseStore(): NotificationStore {
  const supabase = createWorkerClient();

  return {
    async claim(limit, leaseSeconds) {
      const { data, error } = await withDeadline(DATABASE_TIMEOUT_MS, (signal) =>
        supabase
          .rpc('claim_notifications', {
            p_limit: limit,
            p_lease_seconds: leaseSeconds,
          })
          .abortSignal(signal),
      );
      if (error) throw new Error(`Could not claim notifications: ${error.message}`);
      return (data ?? []) as NotificationOutboxRow[];
    },
    async markSent(id, claimToken, providerMessageId) {
      const { data, error } = await withDeadline(DATABASE_TIMEOUT_MS, (signal) =>
        supabase
          .rpc('mark_notification_sent', {
            p_id: id,
            p_claim_token: claimToken,
            p_provider_message_id: providerMessageId,
          })
          .abortSignal(signal),
      );
      if (error || data !== true)
        throw new Error('Sent acknowledgement failed or lease is no longer owned');
    },
    async markFailed(id, claimToken, errorMessage, permanent) {
      const { data, error } = await withDeadline(DATABASE_TIMEOUT_MS, (signal) =>
        supabase
          .rpc('mark_notification_failed', {
            p_id: id,
            p_claim_token: claimToken,
            p_error: errorMessage,
            p_permanent: permanent,
          })
          .abortSignal(signal),
      );
      if (error || data !== true)
        throw new Error('Failure acknowledgement failed or lease is no longer owned');
    },
  };
}

export async function processNotifications(options: ProcessOptions = {}): Promise<ProcessResult> {
  const store = options.store ?? supabaseStore();
  const provider = options.provider ?? resolveEmailProvider();

  const deadline = Date.now() + WORKER_BUDGET_MS;
  const limit = Math.min(100, Math.max(1, options.limit ?? DEFAULT_BATCH));
  const result: ProcessResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    provider: provider.name,
    acknowledgementErrors: 0,
    budgetExhausted: false,
  };
  while (result.claimed < limit) {
    // Reserve time for the claim, all recipients, and the acknowledgement.
    if (deadline - Date.now() < PROVIDER_TIMEOUT_MS + 2 * DATABASE_TIMEOUT_MS) {
      result.budgetExhausted = true;
      break;
    }
    const rows = await withDeadline(DATABASE_TIMEOUT_MS, () =>
      store.claim(1, options.leaseSeconds ?? DEFAULT_LEASE_SECONDS),
    );
    if (!rows.length) break;
    const row = rows[0]!;
    result.claimed++;
    try {
      if (!row.claim_token) throw new Error('Claim has no ownership token');
      let outcome: Outcome;
      try {
        outcome = await withDeadline(PROVIDER_TIMEOUT_MS, (signal) =>
          deliver(row, provider, signal),
        );
      } catch {
        // Delivery is ambiguous. Preserve the event key and schedule a retry.
        outcome = {
          kind: 'failed',
          permanent: false,
          message: 'Provider operation failed or timed out; delivery outcome unknown',
        };
      }
      if (outcome.kind === 'sent') {
        await withDeadline(DATABASE_TIMEOUT_MS, () =>
          store.markSent(row.id, row.claim_token!, outcome.id),
        );
        result.sent++;
      } else {
        await withDeadline(DATABASE_TIMEOUT_MS, () =>
          store.markFailed(
            row.id,
            row.claim_token!,
            redactSecrets(outcome.message),
            outcome.permanent,
          ),
        );
        if (outcome.permanent) result.skipped++;
        else result.failed++;
      }
    } catch (error) {
      // Never compensate an ambiguous sent acknowledgement with a failure write.
      // The DB may have committed; otherwise lease recovery owns the next step.
      result.acknowledgementErrors++;
      console.error(
        '[notifications] acknowledgement failed',
        row.id,
        redactSecrets(error instanceof Error ? error.message : 'Unknown acknowledgement error'),
      );
    }
  }

  return result;
}

type Outcome =
  { kind: 'sent'; id: string | null } | { kind: 'failed'; permanent: boolean; message: string };

async function deliver(
  row: NotificationOutboxRow,
  provider: EmailProvider,
  signal: AbortSignal,
): Promise<Outcome> {
  if (!isNotificationEventType(row.event_type)) {
    // A row written by a newer migration than this deployment understands.
    // Permanent from this build's point of view; a later deploy can retry it.
    return { kind: 'failed', permanent: true, message: `Unknown event type ${row.event_type}` };
  }

  const recipients = recipientsFor(row);
  if (recipients.length === 0) {
    return {
      kind: 'failed',
      permanent: true,
      message:
        EVENT_RECIPIENT[row.event_type] === 'ADMIN'
          ? 'ADMIN_NOTIFICATION_EMAIL is not configured'
          : 'No recipient address on this notification',
    };
  }

  if (!row.project_id) {
    return { kind: 'failed', permanent: true, message: 'Notification has no project' };
  }

  const payload = (row.payload ?? {}) as { reference?: unknown; previewVersion?: unknown };
  const reference = typeof payload.reference === 'string' ? payload.reference : null;

  if (!reference) {
    return { kind: 'failed', permanent: true, message: 'Notification has no project reference' };
  }

  const email = renderNotificationEmail(row.event_type, {
    reference,
    siteUrl: siteUrl(),
    projectId: row.project_id,
    previewVersion: typeof payload.previewVersion === 'number' ? payload.previewVersion : undefined,
  });

  // One row can address several operators. They are sent individually so that a
  // rejected address for one does not deny the message to the others, and the
  // idempotency key is per address for the same reason.
  let lastFailure: Outcome | null = null;
  let firstId: string | null = null;
  let anySent = false;

  for (const [index, to] of recipients.entries()) {
    signal.throwIfAborted();
    const sendResult = await provider.send(
      {
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: index === 0 ? row.dedupe_key : `${row.dedupe_key}#${index}`,
      },
      { signal },
    );

    if (sendResult.ok) {
      anySent = true;
      firstId ??= sendResult.id;
    } else {
      lastFailure = {
        kind: 'failed',
        permanent: sendResult.permanent,
        message: sendResult.message,
      };
    }
  }

  // Preserve event keys on partial retries. Provider deduplication has a finite
  // retention window; this is not an exactly-once inbox delivery guarantee.
  if (lastFailure) return lastFailure;
  return anySent
    ? { kind: 'sent', id: firstId }
    : { kind: 'failed', permanent: true, message: 'No delivery attempted' };
}

function recipientsFor(row: NotificationOutboxRow): string[] {
  if (row.recipient === 'ADMIN') return adminNotificationRecipients();
  return row.recipient_email ? [row.recipient_email] : [];
}
