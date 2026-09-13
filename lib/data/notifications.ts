import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { NotificationOutboxRow, NotificationStatus } from '@/types/database';

/**
 * Reads for the admin notification view.
 *
 * These run as the signed-in administrator through the ordinary RLS-bound
 * client, not the worker's client. The only policy on notification_outbox is
 * "admin can read", so a customer reaching this code path sees nothing — the
 * page's gate and the database's policy agree, independently.
 */

export interface NotificationSummary {
  pending: number;
  processing: number;
  retrying: number;
  /** Attempts exhausted. These are the ones that need a person. */
  deadLettered: number;
  sentLast24h: number;
}

export interface NotificationListRow extends NotificationOutboxRow {
  projectReference: string | null;
}

export async function getNotificationSummary(): Promise<NotificationSummary> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = () =>
    supabase.from('notification_outbox').select('id', { count: 'exact', head: true });

  const [pending, processing, retrying, deadLettered, sent] = await Promise.all([
    rows().eq('status', 'PENDING'),
    rows().eq('status', 'PROCESSING'),
    // FAILED but still due: the worker will pick these up again by itself.
    rows().eq('status', 'FAILED').not('next_attempt_at', 'is', null),
    // FAILED with no next attempt: the budget is spent and nothing more will
    // happen without an operator.
    rows().eq('status', 'FAILED').is('next_attempt_at', null),
    rows().eq('status', 'SENT').gte('sent_at', since),
  ]);

  return {
    pending: pending.count ?? 0,
    processing: processing.count ?? 0,
    retrying: retrying.count ?? 0,
    deadLettered: deadLettered.count ?? 0,
    sentLast24h: sent.count ?? 0,
  };
}

/** The most recent notifications, newest first, with the project's public reference. */
export async function listRecentNotifications(limit = 50): Promise<NotificationListRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('notification_outbox')
    .select('*, projects(public_reference)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => {
    const { projects, ...rest } = row as NotificationOutboxRow & {
      projects: { public_reference: string } | null;
    };
    return { ...rest, projectReference: projects?.public_reference ?? null };
  });
}

/** Whether an operator can do anything about this row. */
export function isDeadLettered(row: Pick<NotificationOutboxRow, 'status' | 'next_attempt_at'>) {
  return row.status === 'FAILED' && row.next_attempt_at === null;
}

export function notificationStatusTone(
  status: NotificationStatus,
  nextAttemptAt: string | null,
): 'ok' | 'warn' | 'bad' | 'muted' {
  if (status === 'SENT') return 'ok';
  if (status === 'FAILED') return nextAttemptAt === null ? 'bad' : 'warn';
  return 'muted';
}
