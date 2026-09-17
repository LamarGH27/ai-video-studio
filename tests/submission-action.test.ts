import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitProjectAction } from '@/features/create-project/actions';

const f = vi.hoisted(() => ({
  user: { id: 'aaaaaaaa-0000-4000-8000-00000000000a' } as { id: string } | null,
  rpc: vi.fn(),
  from: vi.fn(() => {
    throw new Error('Submission must use the atomic RPC');
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => f }));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: async () => f.user }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const input = {
  projectId: '94000000-0000-4000-8000-000000000001',
  hasLikenessPermission: true as const,
  aiProcessingConsent: true as const,
  portfolioPermission: false,
};
const committed = { projectId: input.projectId, publicReference: 'AVS-000123' };
beforeEach(() => {
  vi.clearAllMocks();
  f.user = { id: 'aaaaaaaa-0000-4000-8000-00000000000a' };
  f.rpc.mockResolvedValue({ data: committed, error: null });
});

describe('atomic project submission action', () => {
  it('sends only project identity and consent decisions to the RPC', async () => {
    expect(await submitProjectAction(input)).toEqual({ ok: true, data: committed });
    expect(f.rpc).toHaveBeenCalledWith('submit_project', {
      p_project_id: input.projectId,
      p_has_likeness_permission: true,
      p_ai_processing_consent: true,
      p_portfolio_permission: false,
    });
    expect(f.from).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    f.user = null;
    expect(await submitProjectAction(input)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('rejects false mandatory consent before dispatch', async () => {
    expect(
      await submitProjectAction({ ...input, aiProcessingConsent: false } as never),
    ).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('keeps explicit optional consent', async () => {
    await submitProjectAction({ ...input, portfolioPermission: true });
    expect(f.rpc).toHaveBeenCalledWith(
      'submit_project',
      expect.objectContaining({ p_portfolio_permission: true }),
    );
  });
  it.each([
    ['23514', 'VALIDATION'],
    ['42501', 'CONFLICT'],
    ['08006', 'ERROR'],
    ['40P01', 'ERROR'],
  ])('maps database failure %s without a fallback direct update', async (code, expected) => {
    f.rpc.mockResolvedValue({ data: null, error: { code } });
    expect(await submitProjectAction(input)).toMatchObject({ ok: false, code: expected });
    expect(f.from).not.toHaveBeenCalled();
  });
  it('permits retry after an ambiguous lost response', async () => {
    f.rpc.mockRejectedValueOnce(new Error('Response lost after commit'));
    expect(await submitProjectAction(input)).toMatchObject({ ok: false, code: 'ERROR' });
    expect(await submitProjectAction(input)).toEqual({ ok: true, data: committed });
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.from).not.toHaveBeenCalled();
  });
  it('rejects an empty database response', async () => {
    f.rpc.mockResolvedValue({ data: null, error: null });
    expect(await submitProjectAction(input)).toMatchObject({ ok: false, code: 'ERROR' });
  });
});
