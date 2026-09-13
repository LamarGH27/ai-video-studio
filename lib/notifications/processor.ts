import 'server-only';

import { createWorkerClient } from '@/lib/supabase/worker';
import { siteUrl } from '@/lib/env';
import { adminNotificationRecipients } from '@/lib/notifications/config';
import { isNotificationEventType, EVENT_RECIPIENT } from '@/lib/notifications/events';
import { resolveEmailProvider } from '@/lib/notifications/providers';
import type { EmailProvider } from '@/lib/notifications/provider';
import { renderNotificationEmail } from '@/lib/notifications/templates';
import type { NotificationOutboxRow } from '@/types/database';

/**
 * The queue runner.
 *
 * Shape, and why:
 *
 *   1. claim_notifications() takes a bounded batch in ONE short database
 *      transaction, using FOR UPDATE SKIP LOCKED. Two runners overlapping —
 *      which they will, because a cron tick can land while a manual run is in
 *      flight — take disjoint rows rather than the same row twice.
 *
 *   2. That transaction then COMMITS, and only afterwards does anything talk to
 *      the email provider. Holding a transaction open across somebody else's
 *      HTTP call means their slowest response is how long we hold locks, and a
 *      provider timeout becomes a database incident. The claim instead sets a
 *      lease: the row is invisible to other runners until it expires, and a
 *      runner that dies mid-send releases its rows by doing nothing at all.
 *
 *   3. Each result is reported back individually, so one bad row cannot cost
 *      the batch. The attempt count was already incremented by the claim, so a
 *      row that kills the process still counts as attempted and cannot spin.
 *
 * The recipient is resolved HERE, not in the database. A customer row carries
 * the address captured from auth.users when the event happened; an admin row
 * carries none and is addressed from ADMIN_NOTIFICATION_EMAIL at this moment.
 */

export interface ProcessResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  provider: string;
}

/** The three database calls the worker makes. Narrow on purpose: it is also
 *  the seam tests substitute, so a test cannot accidentally exercise more of
 *  the database surface than the worker itself is allowed to touch. */
export interface NotificationStore {
  claim(limit: number, leaseSeconds: number): Promise<NotificationOutboxRow[]>;
  markSent(id: string, providerMessageId: string | null): Promise<void>;
  markFailed(id: string, error: string, permanent: boolean): Promise<void>;
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
      const { data, error } = await supabase.rpc('claim_notifications', {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`Could not claim notifications: ${error.message}`);
      return (data ?? []) as NotificationOutboxRow[];
    },
    async markSent(id, providerMessageId) {
      await supabase.rpc('mark_notification_sent', {
        p_id: id,
        p_provider_message_id: providerMessageId,
      });
    },
    async markFailed(id, error, permanent) {
      await supabase.rpc('mark_notification_failed', {
        p_id: id,
        p_error: error,
        p_permanent: permanent,
      });
    },
  };
}

export async function processNotifications(options: ProcessOptions = {}): Promise<ProcessResult> {
  const store = options.store ?? supabaseStore();
  const provider = options.provider ?? resolveEmailProvider();

  const rows = await store.claim(
    options.limit ?? DEFAULT_BATCH,
    options.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  );
  const result: ProcessResult = {
    claimed: rows.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    provider: provider.name,
  };

  for (const row of rows) {
    const outcome = await deliver(row, provider);

    if (outcome.kind === 'sent') {
      await store.markSent(row.id, outcome.id);
      result.sent += 1;
      continue;
    }

    await store.markFailed(row.id, outcome.message, outcome.permanent);
    if (outcome.permanent) result.skipped += 1;
    else result.failed += 1;
  }

  return result;
}

type Outcome =
  { kind: 'sent'; id: string | null } | { kind: 'failed'; permanent: boolean; message: string };

async function deliver(row: NotificationOutboxRow, provider: EmailProvider): Promise<Outcome> {
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
    const sendResult = await provider.send({
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: index === 0 ? row.dedupe_key : `${row.dedupe_key}#${index}`,
    });

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

  // A partial success is still a failure to report: retrying is safe, because
  // the provider's idempotency key suppresses the deliveries that did succeed.
  if (lastFailure) return lastFailure;
  return anySent
    ? { kind: 'sent', id: firstId }
    : { kind: 'failed', permanent: true, message: 'No delivery attempted' };
}

function recipientsFor(row: NotificationOutboxRow): string[] {
  if (row.recipient === 'ADMIN') return adminNotificationRecipients();
  return row.recipient_email ? [row.recipient_email] : [];
}
