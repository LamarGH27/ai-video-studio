import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authoriseDeliveryAsset, signDeliveryAsset } from '@/lib/data/deliveries';
import { downloadFinal } from '@/lib/data/final-download';
import { releaseFinalVideoAction } from '@/features/delivery/admin-actions';
const mocks = vi.hoisted(() => ({
  client: {} as unknown,
  user: 'aaaaaaaa-0000-4000-8000-00000000000a',
  admin: false,
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.client }));
vi.mock('@/lib/auth/session', () => ({
  getSessionUser: async () => ({ id: mocks.user }),
  getProfile: async () => ({ role: mocks.admin ? 'admin' : 'customer' }),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock('@/lib/env', () => ({
  requireSupabaseEnv: () => ({
    url: 'https://fixture.invalid',
    publishableKey: 'test-publishable',
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const id = '55555555-0000-4000-8000-000000000005',
  projectId = '11111111-0000-4000-8000-000000000001';
function fixture() {
  const asset = {
    id,
    project_id: projectId,
    user_id: mocks.user,
    asset_type: 'FINAL_VIDEO' as const,
    storage_bucket: 'project-deliveries',
    storage_path: mocks.user + '/' + projectId + '/final.mp4',
    mime_type: 'video/mp4',
    file_size: 3,
    version: 1,
    original_filename: 'final.mp4',
    created_at: '2026-01-01',
  };
  const project = {
    id: projectId,
    user_id: mocks.user,
    status: 'COMPLETED',
    public_reference: 'AVS-TEST',
  };
  const rpc = vi.fn(async () => ({ data: true as unknown, error: null as unknown }));
  const sign = vi.fn();
  mocks.client = {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: table === 'projects' ? project : asset, error: null }),
      };
      return query;
    },
    rpc,
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'test-session-token' } },
        error: null,
      }),
    },
    storage: { from: () => ({ createSignedUrl: sign }) },
  };
  return { asset, project, rpc, sign };
}
beforeEach(() => {
  mocks.user = 'aaaaaaaa-0000-4000-8000-00000000000a';
  mocks.admin = false;
  mocks.requireAdmin.mockReset();
  vi.unstubAllGlobals();
});
describe('authoritative final access', () => {
  it('rejects a final in FINALISING even if an asset row is returned', async () => {
    const f = fixture();
    f.project.status = 'FINALISING';
    expect(await authoriseDeliveryAsset(id)).toBeNull();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('checks the exact release identity independently of RLS', async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: false, error: null });
    expect(await authoriseDeliveryAsset(id)).toBeNull();
    expect(f.rpc).toHaveBeenCalledWith('is_released_final', { p_asset_id: id });
  });
  it('fails closed on a release lookup failure', async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: null, error: { code: 'failure' } });
    expect(await authoriseDeliveryAsset(id)).toBeNull();
  });
  it('allows the exact released final', async () => {
    fixture();
    expect((await authoriseDeliveryAsset(id))?.asset.id).toBe(id);
  });
  it('rejects another customer independently of RLS', async () => {
    const f = fixture();
    f.project.user_id = 'bbbbbbbb-0000-4000-8000-00000000000b';
    expect(await authoriseDeliveryAsset(id)).toBeNull();
  });
  it('does not mint a final bearer URL even for an admin', async () => {
    const f = fixture();
    mocks.admin = true;
    expect(await signDeliveryAsset(f.asset)).toBeNull();
    expect(f.sign).not.toHaveBeenCalled();
  });
  it('does not contact Storage when release authorization fails', async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: false, error: null });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await downloadFinal(id, null)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('streams authenticated bytes without leaking an upstream URL or token', async () => {
    fixture();
    const fetcher = vi.fn(
      async () =>
        new Response('abc', {
          status: 206,
          headers: {
            'content-range': 'bytes 0-2/3',
            'content-length': '3',
            location: 'https://fixture.invalid/private',
          },
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await downloadFinal(id, 'bytes=0-2', 'final.mp4');
    expect(await result?.text()).toBe('abc');
    expect(result?.status).toBe(206);
    expect(result?.headers.get('location')).toBeNull();
    expect(result?.headers.get('cache-control')).toContain('no-store');
    expect(fetcher.mock.calls[0]?.length).toBe(2);
  });
  it('fails closed if Storage rejects access after application authorization', async () => {
    fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('denied', { status: 403 })),
    );
    expect(await downloadFinal(id, null)).toBeNull();
  });
});
describe('explicit admin release action', () => {
  it('passes the chosen identity to the transactional RPC', async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: { assetId: id, status: 'COMPLETED' }, error: null });
    expect((await releaseFinalVideoAction({ projectId, assetId: id })).ok).toBe(true);
    expect(f.rpc).toHaveBeenCalledWith('release_final_video', {
      p_project_id: projectId,
      p_asset_id: id,
    });
  });
  it('does not release if admin authorization rejects', async () => {
    const f = fixture();
    mocks.requireAdmin.mockRejectedValue(new Error('forbidden'));
    await expect(releaseFinalVideoAction({ projectId, assetId: id })).rejects.toThrow('forbidden');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('reports transaction failure without issuing a second mutation', async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: null, error: { code: '40001' } });
    expect((await releaseFinalVideoAction({ projectId, assetId: id })).ok).toBe(false);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
});
