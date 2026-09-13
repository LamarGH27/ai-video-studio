import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVENT_RECIPIENT,
  MAX_NOTIFICATION_ATTEMPTS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_STATUSES,
  dedupeKey,
  isNotificationEventType,
  isPermanentlyFailed,
  retryDelayMs,
} from '@/lib/notifications/events';

/**
 * The notification model lives in SQL — the enum, the dedupe keys the triggers
 * build, and the retry schedule are all defined in migration 000700. The
 * TypeScript copy exists to render and to test with, so it is compared against
 * the migration rather than trusted.
 *
 * Same arrangement as tests/status-model-consistency.test.ts, for the same
 * reason: two copies of a rule drift silently, and here the drift would mean
 * emails that never send or a dedupe key that stops deduplicating.
 */

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260101000700_notification_outbox.sql'),
  'utf8',
);

describe('event types: SQL and TypeScript agree', () => {
  it('declares the same events, in the same order', () => {
    const block = /create type public\.notification_event_type as enum \(([\s\S]*?)\);/.exec(
      MIGRATION,
    );
    expect(block, 'notification_event_type enum not found in migration 000700').not.toBeNull();

    const values = [...block![1]!.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
    expect(values.length).toBeGreaterThan(0);
    expect(values).toEqual([...NOTIFICATION_EVENT_TYPES]);
  });

  it('declares the same statuses', () => {
    const block = /create type public\.notification_status as enum \(([^)]*)\);/.exec(MIGRATION);
    expect(block).not.toBeNull();
    const values = [...block![1]!.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
    expect(values).toEqual([...NOTIFICATION_STATUSES]);
  });

  it('addresses every event to exactly one audience, matching its name', () => {
    for (const event of NOTIFICATION_EVENT_TYPES) {
      const expected = event.endsWith('_ADMIN') ? 'ADMIN' : 'CUSTOMER';
      expect(EVENT_RECIPIENT[event], `${event} is addressed to the wrong audience`).toBe(expected);
    }
  });

  it('recognises only events the database defines', () => {
    expect(isNotificationEventType('PREVIEW_READY_CUSTOMER')).toBe(true);
    expect(isNotificationEventType('preview_ready_customer')).toBe(false);
    expect(isNotificationEventType('MARKETING_BLAST')).toBe(false);
  });

  /**
   * Only the events the brief asks for. An enum that grows a value nobody
   * decided to send is how a transactional system turns into a marketing one.
   */
  it('sends nothing beyond the eight transactional events', () => {
    expect(NOTIFICATION_EVENT_TYPES).toHaveLength(8);
    expect(NOTIFICATION_EVENT_TYPES.filter((e) => e.endsWith('_CUSTOMER'))).toHaveLength(5);
    expect(NOTIFICATION_EVENT_TYPES.filter((e) => e.endsWith('_ADMIN'))).toHaveLength(3);
  });
});

describe('dedupe keys', () => {
  const PROJECT = '11111111-2222-4333-8444-555555555555';
  const ASSET = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('builds the exact strings the triggers build', () => {
    // The triggers use format() with the same shapes; these are the literals
    // that must match, and the database suite asserts the preview one against a
    // real row.
    expect(dedupeKey.projectSubmitted(PROJECT, 'CUSTOMER')).toBe(
      `project:${PROJECT}:submitted:customer`,
    );
    expect(dedupeKey.projectSubmitted(PROJECT, 'ADMIN')).toBe(`project:${PROJECT}:submitted:admin`);
    expect(dedupeKey.previewReady(PROJECT, ASSET)).toBe(
      `project:${PROJECT}:preview:${ASSET}:ready`,
    );
    expect(dedupeKey.revisionRequested(PROJECT, ASSET)).toBe(
      `project:${PROJECT}:revision:${ASSET}:admin`,
    );
    expect(dedupeKey.previewApproved(PROJECT, ASSET, 'ADMIN')).toBe(
      `project:${PROJECT}:approval:${ASSET}:admin`,
    );
    expect(dedupeKey.projectCompleted(PROJECT)).toBe(`project:${PROJECT}:completed:customer`);
  });

  it('matches the format() calls in the migration', () => {
    for (const shape of [
      'project:%s:submitted:customer',
      'project:%s:submitted:admin',
      'project:%s:preview:%s:ready',
      'project:%s:revision:%s:admin',
      'project:%s:approval:%s:customer',
      'project:%s:approval:%s:admin',
      'project:%s:completed:customer',
    ]) {
      expect(MIGRATION, `the trigger no longer builds ${shape}`).toContain(shape);
    }
  });

  /**
   * A preview key names the ASSET, not the project. Keying on the project would
   * mean the second preview reuses the first preview's key and the customer is
   * never told their revision was answered — a missing email, which is the
   * failure nobody notices.
   */
  it('keys a preview on the asset, so a replacement is its own notification', () => {
    const second = 'ffffffff-1111-4222-8333-444444444444';
    expect(dedupeKey.previewReady(PROJECT, ASSET)).not.toBe(
      dedupeKey.previewReady(PROJECT, second),
    );
  });

  it('gives the customer and the admin copies different keys', () => {
    expect(dedupeKey.projectSubmitted(PROJECT, 'CUSTOMER')).not.toBe(
      dedupeKey.projectSubmitted(PROJECT, 'ADMIN'),
    );
    expect(dedupeKey.previewApproved(PROJECT, ASSET, 'CUSTOMER')).not.toBe(
      dedupeKey.previewApproved(PROJECT, ASSET, 'ADMIN'),
    );
  });

  it('is deterministic — the same event always produces the same key', () => {
    expect(dedupeKey.previewReady(PROJECT, ASSET)).toBe(dedupeKey.previewReady(PROJECT, ASSET));
  });
});

describe('retry schedule', () => {
  it('matches notification_retry_delay() in the migration', () => {
    const fn = /create or replace function public\.notification_retry_delay[\s\S]*?\$\$;/.exec(
      MIGRATION,
    );
    expect(fn, 'notification_retry_delay() not found').not.toBeNull();

    const rows = [...fn![0]!.matchAll(/when (\d+) then interval '([^']+)'/g)].map((match) => ({
      attempt: Number(match[1]),
      interval: match[2]!,
    }));
    expect(rows.length, 'parsed no delays — the CASE shape must have changed').toBe(4);

    const asMs: Record<string, number> = {
      '1 minute': 60_000,
      '5 minutes': 5 * 60_000,
      '30 minutes': 30 * 60_000,
      '2 hours': 2 * 60 * 60_000,
    };

    for (const row of rows) {
      expect(retryDelayMs(row.attempt), `attempt ${row.attempt} differs from the migration`).toBe(
        asMs[row.interval],
      );
    }
  });

  it('matches notification_max_attempts() in the migration', () => {
    const fn =
      /create or replace function public\.notification_max_attempts[\s\S]*?select (\d+)/.exec(
        MIGRATION,
      );
    expect(fn, 'notification_max_attempts() not found').not.toBeNull();
    expect(Number(fn![1])).toBe(MAX_NOTIFICATION_ATTEMPTS);
  });

  it('backs off, and never grows without bound', () => {
    const delays = [1, 2, 3, 4].map((attempt) => retryDelayMs(attempt)!);
    expect(delays.every((delay) => delay > 0)).toBe(true);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
    // Never hammer the provider: the first retry is a minute away, not instant.
    expect(delays[0]).toBeGreaterThanOrEqual(60_000);
  });

  it('stops once the budget is spent', () => {
    expect(retryDelayMs(MAX_NOTIFICATION_ATTEMPTS)).toBeNull();
    expect(retryDelayMs(99)).toBeNull();
  });

  it('refuses nonsense rather than guessing', () => {
    expect(retryDelayMs(0)).toBeNull();
    expect(retryDelayMs(-1)).toBeNull();
    expect(retryDelayMs(1.5)).toBeNull();
  });

  it('recognises a row nothing further will happen to', () => {
    expect(isPermanentlyFailed({ status: 'FAILED', attempt_count: 5, next_attempt_at: null })).toBe(
      true,
    );
    // Still scheduled: the worker will pick it up by itself, no operator needed.
    expect(
      isPermanentlyFailed({
        status: 'FAILED',
        attempt_count: 2,
        next_attempt_at: new Date().toISOString(),
      }),
    ).toBe(false);
    expect(isPermanentlyFailed({ status: 'SENT', attempt_count: 1, next_attempt_at: null })).toBe(
      false,
    );
  });
});
