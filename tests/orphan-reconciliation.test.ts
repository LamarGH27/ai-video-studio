import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileOrphanedReferenceImages } from '@/lib/data/assets';

const session = vi.hoisted(() => ({ client: {} as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => session.client }));

const USER = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PROJECT = '11111111-0000-4000-8000-000000000001';
const PREFIX = `${USER}/${PROJECT}`;
const OLD = '2020-01-01T00:00:00Z';
type Read = { data: { storage_path: string }[] | null; error: { message: string } | null } | Error;

type Claim = { data: string[] | null; error: { message: string } | null } | Error;

function fixture(reads: Read[], claimResult?: Claim) {
  const objects = [
    { name: 'orphan.jpg', created_at: OLD },
    { name: 'tracked.jpg', created_at: OLD },
    { name: 'recent.jpg', created_at: new Date().toISOString() },
    { name: 'unknown.jpg', created_at: '' },
  ];
  const read = vi.fn(async () => {
    const result = reads.shift();
    if (result instanceof Error) throw result;
    if (!result) throw new Error('Unexpected database read');
    return result;
  });
  const from = vi.fn(() => {
    const query = {
      select: () => query,
      eq: () => query,
      then: (
        resolve: (result: Exclude<Read, Error>) => unknown,
        reject: (reason: unknown) => unknown,
      ) => read().then(resolve, reject),
    };
    return query;
  });
  const remove = vi.fn(
    async (_paths: string[]): Promise<{ error: { message: string } | null }> => ({ error: null }),
  );
  const claim = vi.fn(async (_name: string, args: { p_paths: string[] }) => {
    if (claimResult instanceof Error) throw claimResult;
    return claimResult ?? { data: args.p_paths, error: null };
  });
  session.client = {
    from,
    rpc: claim,
    storage: { from: () => ({ list: async () => ({ data: objects, error: null }), remove }) },
  };
  return { read, remove, claim };
}
const tracked = (...names: string[]): Read => ({
  data: names.map((name) => ({ storage_path: `${PREFIX}/${name}` })),
  error: null,
});
const failed: Read = { data: null, error: { message: 'Database unavailable' } };

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe('conservative reference reconciliation', () => {
  it('removes only genuine old orphans after a committed database claim', async () => {
    const f = fixture([tracked('tracked.jpg')]);
    expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(1);
    expect(f.remove).toHaveBeenCalledExactlyOnceWith([`${PREFIX}/orphan.jpg`]);
    expect(f.claim).toHaveBeenCalledExactlyOnceWith('claim_reference_orphans', {
      p_project_id: PROJECT,
      p_paths: [`${PREFIX}/orphan.jpg`],
    });
    expect(f.claim.mock.invocationCallOrder[0]).toBeLessThan(
      f.remove.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
    );
  });

  it('treats successful empty results as known absence, not query failure', async () => {
    const f = fixture([tracked()]);
    expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(2);
    expect(f.remove).toHaveBeenCalledExactlyOnceWith([
      `${PREFIX}/orphan.jpg`,
      `${PREFIX}/tracked.jpg`,
    ]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([failed, new Error('Network disconnected'), { data: null, error: null }] as Read[])(
    'does not delete when the initial metadata read is uncertain (%j)',
    async (failure) => {
      const f = fixture([failure]);
      expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(0);
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.claim).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledOnce();
    },
  );

  it.each([failed, new Error('Lost claim response'), { data: null, error: null }] as Claim[])(
    'does not delete any candidates when the authoritative claim is uncertain (%j)',
    async (failure) => {
      const f = fixture([tracked('tracked.jpg')], failure);
      expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(0);
      expect(f.remove).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledOnce();
    },
  );

  it('preserves an apparent orphan when confirmation wins before the claim', async () => {
    const f = fixture([tracked('tracked.jpg')], { data: [], error: null });
    expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(0);
    expect(f.claim).toHaveBeenCalledOnce();
    expect(f.remove).not.toHaveBeenCalled();
  });

  it('removes the remaining orphan when another candidate becomes committed', async () => {
    const f = fixture([tracked()], { data: [`${PREFIX}/tracked.jpg`], error: null });
    expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(1);
    expect(f.remove).toHaveBeenCalledExactlyOnceWith([`${PREFIX}/tracked.jpg`]);
  });

  it('logs a failed Storage deletion without issuing any claim release', async () => {
    const f = fixture([tracked('tracked.jpg')]);
    f.remove.mockResolvedValueOnce({ error: { message: 'Unavailable' } });
    expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(0);
    expect(f.claim).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it('safely retries an ambiguous Storage response using the same durable claim', async () => {
    const f = fixture([tracked('tracked.jpg'), tracked('tracked.jpg')]);
    f.remove.mockRejectedValueOnce(new Error('Response lost'));
    expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(0);
    expect(await reconcileOrphanedReferenceImages(USER, PROJECT)).toBe(1);
    expect(f.claim).toHaveBeenCalledTimes(2);
    expect(f.remove.mock.calls).toEqual([[[`${PREFIX}/orphan.jpg`]], [[`${PREFIX}/orphan.jpg`]]]);
  });
});
