import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProvider, SendResult } from '@/lib/notifications/provider';
import { processNotifications, type NotificationStore } from '@/lib/notifications/processor';
import type { NotificationOutboxRow } from '@/types/database';

/**
 * The worker, with the database and the provider replaced.
 *
 * What is worth testing here is the decision-making: who a row is addressed to,
 * which failures are worth another attempt, and what happens to a row this
 * build does not understand. The claiming itself is a SQL concern and is tested
 * against a real PostgreSQL in supabase/tests/06_notification_outbox.sql —
 * FOR UPDATE SKIP LOCKED cannot be meaningfully faked.
 */

const PROJECT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function row(overrides: Partial<NotificationOutboxRow> = {}): NotificationOutboxRow {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    event_type: 'PREVIEW_READY_CUSTOMER',
    recipient: 'CUSTOMER',
    recipient_user_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    recipient_email: 'customer@example.com',
    project_id: PROJECT_ID,
    payload: { reference: 'AVS-000123', previewVersion: 1 },
    status: 'PROCESSING',
    claim_token: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    attempt_count: 1,
    next_attempt_at: new Date(Date.now() + 300_000).toISOString(),
    claimed_at: new Date().toISOString(),
    sent_at: null,
    last_error: null,
    provider_message_id: null,
    dedupe_key: `project:${PROJECT_ID}:preview:x:ready`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function fakeStore(rows: NotificationOutboxRow[]) {
  const sent: { id: string; providerMessageId: string | null }[] = [];
  const failed: { id: string; error: string; permanent: boolean }[] = [];

  const store: NotificationStore = {
    async claim() {
      return rows.splice(0, 1);
    },
    async markSent(id, _claimToken, providerMessageId) {
      sent.push({ id, providerMessageId });
    },
    async markFailed(id, _claimToken, error, permanent) {
      failed.push({ id, error, permanent });
    },
  };

  return { store, sent, failed };
}

function fakeProvider(result: SendResult = { ok: true, id: 'msg_1' }) {
  const calls: { to: string; subject: string; idempotencyKey: string }[] = [];
  const provider: EmailProvider = {
    name: 'fake',
    async send(email) {
      calls.push({ to: email.to, subject: email.subject, idempotencyKey: email.idempotencyKey });
      return result;
    },
  };
  return { provider, calls };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://studio.example.com';
  process.env.ADMIN_NOTIFICATION_EMAIL = 'studio-ops@example.com';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('addressing', () => {
  it('sends a customer notification to the address captured at enqueue time', async () => {
    const { store, sent } = fakeStore([row()]);
    const { provider, calls } = fakeProvider();

    const result = await processNotifications({ store, provider });

    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(calls[0]!.to).toBe('customer@example.com');
    expect(sent).toEqual([{ id: row().id, providerMessageId: 'msg_1' }]);
  });

  /**
   * An admin row carries no address at all, so that who receives operational
   * mail is a configuration question rather than a schema one — and so that
   * changing it does not require rewriting rows already queued.
   */
  it('addresses an admin notification from configuration, not from the row', async () => {
    const { store } = fakeStore([
      row({ event_type: 'PROJECT_SUBMITTED_ADMIN', recipient: 'ADMIN', recipient_email: null }),
    ]);
    const { provider, calls } = fakeProvider();

    await processNotifications({ store, provider });
    expect(calls.map((call) => call.to)).toEqual(['studio-ops@example.com']);
  });

  it('supports several operators without a schema change', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'ops@example.com, producer@example.com';
    const { store, sent } = fakeStore([
      row({ event_type: 'REVISION_REQUESTED_ADMIN', recipient: 'ADMIN', recipient_email: null }),
    ]);
    const { provider, calls } = fakeProvider();

    await processNotifications({ store, provider });

    expect(calls.map((call) => call.to)).toEqual(['ops@example.com', 'producer@example.com']);
    // Distinct idempotency keys, so the provider does not suppress the second.
    expect(new Set(calls.map((call) => call.idempotencyKey)).size).toBe(2);
    expect(sent).toHaveLength(1);
  });

  it('stops, permanently, when no operator address is configured', async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    const { store, failed } = fakeStore([
      row({ event_type: 'PROJECT_SUBMITTED_ADMIN', recipient: 'ADMIN', recipient_email: null }),
    ]);
    const { provider, calls } = fakeProvider();

    const result = await processNotifications({ store, provider });

    expect(calls).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(failed[0]).toMatchObject({ permanent: true });
    expect(failed[0]!.error).toContain('ADMIN_NOTIFICATION_EMAIL');
  });
});

describe('what the worker does with a failure', () => {
  it('keeps a transient failure retryable', async () => {
    const { store, failed } = fakeStore([row()]);
    const { provider } = fakeProvider({
      ok: false,
      permanent: false,
      message: 'Provider responded 503',
    });

    const result = await processNotifications({ store, provider });

    expect(result).toMatchObject({ sent: 0, failed: 1, skipped: 0 });
    expect(failed[0]).toMatchObject({ permanent: false, error: 'Provider responded 503' });
  });

  it('does not spend the budget re-asking a question already answered', async () => {
    const { store, failed } = fakeStore([row()]);
    const { provider } = fakeProvider({
      ok: false,
      permanent: true,
      message: 'Provider responded 422: invalid address',
    });

    const result = await processNotifications({ store, provider });

    expect(result).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(failed[0]).toMatchObject({ permanent: true });
  });

  it('lets one bad row cost only itself', async () => {
    const good = row({ id: '00000000-0000-4000-8000-000000000001' });
    const bad = row({ id: '00000000-0000-4000-8000-000000000002', recipient_email: null });
    const { store, sent, failed } = fakeStore([bad, good]);
    const { provider } = fakeProvider();

    const result = await processNotifications({ store, provider });

    expect(result).toMatchObject({ claimed: 2, sent: 1 });
    expect(sent.map((s) => s.id)).toEqual([good.id]);
    expect(failed.map((f) => f.id)).toEqual([bad.id]);
  });

  /**
   * A row written by a migration newer than the running build. Permanent from
   * this deployment's point of view; an operator can retry it after deploying.
   */
  it('refuses an event type it does not understand rather than guessing', async () => {
    const { store, failed } = fakeStore([
      row({ event_type: 'SOMETHING_NEW' as NotificationOutboxRow['event_type'] }),
    ]);
    const { provider, calls } = fakeProvider();

    await processNotifications({ store, provider });

    expect(calls).toHaveLength(0);
    expect(failed[0]).toMatchObject({ permanent: true });
    expect(failed[0]!.error).toContain('Unknown event type');
  });

  it('refuses a row with no project reference rather than sending a blank email', async () => {
    const { store, failed } = fakeStore([row({ payload: {} })]);
    const { provider, calls } = fakeProvider();

    await processNotifications({ store, provider });

    expect(calls).toHaveLength(0);
    expect(failed[0]).toMatchObject({ permanent: true });
  });
});

describe('the message it hands the provider', () => {
  it('uses the outbox dedupe key as the idempotency key', async () => {
    const { store } = fakeStore([row()]);
    const { provider, calls } = fakeProvider();

    await processNotifications({ store, provider });
    expect(calls[0]!.idempotencyKey).toBe(row().dedupe_key);
  });

  it('renders the wording the event asks for', async () => {
    const { store } = fakeStore([
      row({
        event_type: 'PREVIEW_REVISED_CUSTOMER',
        payload: { reference: 'AVS-000123', previewVersion: 2 },
      }),
    ]);
    const { provider, calls } = fakeProvider();

    await processNotifications({ store, provider });
    expect(calls[0]!.subject).toBe('Your updated preview is ready — AVS-000123');
  });

  it('reports which provider ran, for the operator reading the result', async () => {
    const { store } = fakeStore([]);
    const { provider } = fakeProvider();
    expect(await processNotifications({ store, provider })).toMatchObject({
      claimed: 0,
      provider: 'fake',
    });
  });
});

describe('worker lease and time bounds', () => {
  it('passes the claimed identity to acknowledgement', async () => {
    const { store } = fakeStore([row()]);
    const mark = vi.spyOn(store, 'markSent');
    await processNotifications({ store, provider: fakeProvider().provider });
    expect(mark).toHaveBeenCalledWith(row().id, row().claim_token, 'msg_1');
  });

  it('continues after an ambiguous acknowledgement without counting it or writing a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, failed } = fakeStore([row(), row({ id: 'second' })]);
    vi.spyOn(store, 'markSent').mockRejectedValueOnce(new Error('Connection lost'));
    const result = await processNotifications({ store, provider: fakeProvider().provider });
    expect(result).toMatchObject({ claimed: 2, sent: 1, acknowledgementErrors: 1, failed: 0 });
    expect(failed).toEqual([]);
  });

  it('a throwing provider schedules a transient failure and preserves the event key on retry', async () => {
    const { store, failed } = fakeStore([row()]);
    const send = vi.fn().mockRejectedValue(new Error('Connection lost'));
    expect(await processNotifications({ store, provider: { name: 'test', send } })).toMatchObject({
      failed: 1,
    });
    expect(failed[0]?.permanent).toBe(false);
    expect(send.mock.calls[0]?.[0].idempotencyKey).toBe(row().dedupe_key);
    const retry = fakeStore([row({ attempt_count: 2, claim_token: 'new-claim' })]);
    send.mockResolvedValue({ ok: true, id: 'provider-id' });
    expect(
      await processNotifications({ store: retry.store, provider: { name: 'test', send } }),
    ).toMatchObject({ sent: 1 });
    expect(send.mock.calls[1]?.[0].idempotencyKey).toBe(row().dedupe_key);
  });

  it('times out stuck providers, leaves unclaimed work queued, and exits within the worker budget', async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const { store } = fakeStore(Array.from({ length: 20 }, () => row()));
      const claim = vi.spyOn(store, 'claim');
      const provider: EmailProvider = { name: 'hanging', send: () => new Promise(() => {}) };
      const pending = processNotifications({ store, provider });
      await vi.advanceTimersByTimeAsync(50_000);
      expect(await pending).toMatchObject({
        claimed: 4,
        failed: 4,
        budgetExhausted: true,
        acknowledgementErrors: 0,
      });
      expect(claim).toHaveBeenCalledTimes(4);
      expect(Date.now() - start).toBeLessThanOrEqual(50_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a hung acknowledgement and does not report it as sent', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { store } = fakeStore([row()]);
      store.markSent = () => new Promise(() => {});
      const pending = processNotifications({ limit: 1, store, provider: fakeProvider().provider });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toMatchObject({ sent: 0, acknowledgementErrors: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});
