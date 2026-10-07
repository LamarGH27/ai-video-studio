import { afterEach, describe, expect, it, vi } from 'vitest';
import { processNotifications } from '@/lib/notifications/processor';
import type { NotificationOutboxRow } from '@/types/database';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/worker', () => ({ createWorkerClient: () => ({ rpc }) }));

const row = {
  id: '11111111-2222-4333-8444-555555555555',
  claim_token: '22222222-2222-4333-8444-555555555555',
  event_type: 'PREVIEW_READY_CUSTOMER',
  recipient: 'CUSTOMER',
  recipient_email: 'test@example.invalid',
  project_id: '33333333-2222-4333-8444-555555555555',
  payload: { reference: 'AVS-000001', previewVersion: 1 },
  status: 'PROCESSING',
  attempt_count: 1,
  next_attempt_at: new Date(Date.now() + 300_000).toISOString(),
  dedupe_key: 'h6-acknowledgement',
} as unknown as NotificationOutboxRow;

afterEach(() => {
  vi.restoreAllMocks();
  rpc.mockReset();
});

describe('notification database acknowledgement', () => {
  it.each([
    [true, 'error'],
    [false, 'error'],
    [true, 'stale'],
    [false, 'stale'],
  ])(
    'does not report acknowledgement when RPC fails (provider success=%s)',
    async (ok, failure) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      rpc.mockImplementation((name: string) => ({
        abortSignal: async () =>
          name === 'claim_notifications'
            ? { data: [row], error: null }
            : {
                data: false,
                error: failure === 'error' ? { message: 'Database unavailable' } : null,
              },
      }));
      const result = await processNotifications({
        limit: 1,
        provider: {
          name: 'test',
          send: async () =>
            ok
              ? { ok: true, id: 'message-1' }
              : { ok: false, permanent: false, message: 'Provider unavailable' },
        },
      });
      expect(result).toMatchObject({ sent: 0, failed: 0, skipped: 0, acknowledgementErrors: 1 });
      expect(console.error).toHaveBeenCalled();
    },
  );
});
