import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectAssetRow, ProjectStatus } from '@/types/database';
import { confirmUploadAction } from '@/features/create-project/actions';
import { confirmDeliveryUploadAction } from '@/features/delivery/admin-actions';

const session = vi.hoisted(() => ({ client: {} as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => session.client }));
vi.mock('@/lib/auth/session', () => ({
  getSessionUser: async () => ({ id: 'aaaaaaaa-0000-4000-8000-00000000000a' }),
  requireAdmin: vi.fn(async () => undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PROJECT = '11111111-0000-4000-8000-000000000001';
const PATH = `${USER}/${PROJECT}/upload`;
type Kind = 'REFERENCE_IMAGE' | 'PREVIEW_VIDEO' | 'FINAL_VIDEO';
type WriteMode = 'normal' | 'lost-response' | 'lost-transport' | 'failure' | 'throw';

function fixture(kind: Kind) {
  const reference = kind === 'REFERENCE_IMAGE';
  const bucket = reference ? 'reference-images' : 'project-deliveries';
  const state = {
    status: (reference
      ? 'DRAFT'
      : kind === 'PREVIEW_VIDEO'
        ? 'IN_PRODUCTION'
        : 'FINALISING') as ProjectStatus,
    asset: null as ProjectAssetRow | null,
    writeMode: 'normal' as WriteMode,
    lookupFails: false,
    lookupThrows: false,
    failRecovery: false,
    writes: 0,
  };
  const committed: ProjectAssetRow = {
    id: '55555555-0000-4000-8000-000000000005',
    project_id: PROJECT,
    user_id: USER,
    asset_type: kind,
    storage_bucket: bucket,
    storage_path: PATH,
    mime_type: reference ? 'image/jpeg' : 'video/mp4',
    file_size: 1024,
    original_filename: 'original',
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
  };
  const failure = { data: null, error: { message: 'Database unavailable' } };
  const write = () => {
    state.writes += 1;
    if (state.writeMode === 'throw') throw new Error('Connection lost');
    if (state.writeMode === 'failure') return failure;
    if (state.asset) return { data: null, error: { message: 'duplicate object', code: '23505' } };
    if (
      state.status !==
      (reference ? 'DRAFT' : kind === 'PREVIEW_VIDEO' ? 'IN_PRODUCTION' : 'FINALISING')
    ) {
      return {
        data: null,
        error: { message: 'Project must be in production or have an approved a preview' },
      };
    }
    state.asset = { ...committed };
    if (kind === 'PREVIEW_VIDEO') state.status = 'PREVIEW_READY';
    if (state.writeMode === 'lost-transport') throw new Error('Response lost after commit');
    if (state.writeMode === 'lost-response') return failure;
    return { data: state.asset, error: null };
  };
  const from = vi.fn((table: string) => {
    let inserting = false;
    const filters: Record<string, unknown> = {};
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: unknown) => {
        filters[key] = value;
        return query;
      }),
      insert: vi.fn(() => {
        inserting = true;
        return query;
      }),
      maybeSingle: vi.fn(async () => {
        if (inserting) return write();
        if (table === 'projects')
          return { data: { id: PROJECT, user_id: USER, status: state.status }, error: null };
        if (state.lookupThrows) throw new Error('Lookup transport failure');
        if (state.lookupFails || (state.failRecovery && state.writes > 0)) return failure;
        const asset = state.asset;
        return {
          data:
            asset &&
            Object.entries(filters).every(
              ([key, value]) => asset[key as keyof ProjectAssetRow] === value,
            )
              ? { ...asset }
              : null,
          error: null,
        };
      }),
    };
    return query;
  });
  const remove = vi.fn(async () => ({ error: null }));
  const info = vi.fn(async () => ({
    data: { size: 1024, contentType: committed.mime_type },
    error: null,
  }));
  const rpc = vi.fn(async (name: string) => {
    const result = write();
    if (name === 'confirm_reference_asset') return result;
    return result.data
      ? {
          data: { assetId: result.data.id, version: result.data.version, status: state.status },
          error: null,
        }
      : result;
  });
  session.client = { from, rpc, storage: { from: vi.fn(() => ({ info, remove })) } };
  const input = { projectId: PROJECT, storagePath: PATH, originalFilename: 'original' };
  const confirm = (overrides = {}) =>
    reference
      ? confirmUploadAction({ ...input, ...overrides })
      : confirmDeliveryUploadAction({ ...input, assetType: kind, ...overrides });
  return { state, committed, confirm, remove, info, rpc };
}

beforeEach(() => vi.clearAllMocks());

describe.each<Kind>(['REFERENCE_IMAGE', 'PREVIEW_VIDEO', 'FINAL_VIDEO'])(
  '%s confirmation',
  (kind) => {
    it('records a normal confirmation without deleting its object', async () => {
      const f = fixture(kind);
      expect(await f.confirm()).toMatchObject({ ok: true, data: { assetId: f.committed.id } });
      expect(f.state.writes).toBe(1);
      expect(f.state.asset).toEqual(f.committed);
      expect(f.remove).not.toHaveBeenCalled();
    });

    it('replays the committed result without another write or Storage lookup', async () => {
      const f = fixture(kind);
      const first = await f.confirm();
      expect(await f.confirm({ originalFilename: 'different retry name' })).toEqual(first);
      expect(f.state.writes).toBe(1);
      expect(f.info).toHaveBeenCalledTimes(1);
      expect(f.remove).not.toHaveBeenCalled();
    });

    it('converges when two confirmations both initially observe no asset', async () => {
      const f = fixture(kind);
      const [first, duplicate] = await Promise.all([f.confirm(), f.confirm()]);
      expect(first).toMatchObject({ ok: true });
      expect(duplicate).toEqual(first);
      expect(f.state.writes).toBe(2);
      expect(f.remove).not.toHaveBeenCalled();
    });

    it.each<WriteMode>(['lost-response', 'lost-transport'])(
      'recovers a committed write after %s',
      async (mode) => {
        const f = fixture(kind);
        f.state.writeMode = mode;
        const recovered = await f.confirm();
        expect(recovered).toMatchObject({ ok: true, data: { assetId: f.committed.id } });
        expect(await f.confirm()).toEqual(recovered);
        expect(f.state.writes).toBe(1);
        expect(f.remove).not.toHaveBeenCalled();
      },
    );

    it('preserves a commit when recovery lookup also fails, then converges on a later retry', async () => {
      const f = fixture(kind);
      f.state.writeMode = 'lost-response';
      f.state.failRecovery = true;
      expect(await f.confirm()).toMatchObject({ ok: false });
      expect(f.state.asset).toEqual(f.committed);
      f.state.failRecovery = false;
      expect(await f.confirm()).toMatchObject({ ok: true, data: { assetId: f.committed.id } });
      expect(f.state.writes).toBe(1);
      expect(f.remove).not.toHaveBeenCalled();
    });

    it.each<WriteMode>(['failure', 'throw'])(
      'does not delete after a database %s without a visible commit',
      async (mode) => {
        const f = fixture(kind);
        f.state.writeMode = mode;
        expect(await f.confirm()).toMatchObject({ ok: false, code: 'ERROR' });
        expect(f.state.asset).toBeNull();
        expect(f.remove).not.toHaveBeenCalled();
      },
    );

    it.each(['lookupFails', 'lookupThrows'] as const)(
      'fails closed on %s before writing',
      async (key) => {
        const f = fixture(kind);
        f.state[key] = true;
        expect(await f.confirm()).toMatchObject({ ok: false, code: 'ERROR' });
        expect(f.state.writes).toBe(0);
        expect(f.remove).not.toHaveBeenCalled();
      },
    );

    it('accepts a committed replay after the project advances', async () => {
      const f = fixture(kind);
      await f.confirm();
      f.state.status = kind === 'REFERENCE_IMAGE' ? 'SUBMITTED' : 'COMPLETED';
      expect(await f.confirm()).toMatchObject({ ok: true, data: { assetId: f.committed.id } });
      expect(f.state.writes).toBe(1);
      expect(f.remove).not.toHaveBeenCalled();
    });

    it('rejects a new confirmation in an invalid workflow state without deletion', async () => {
      const f = fixture(kind);
      f.state.status = 'COMPLETED';
      expect(await f.confirm()).toMatchObject({ ok: false });
      expect(f.state.asset).toBeNull();
      expect(f.remove).not.toHaveBeenCalled();
    });

    it.each(['user_id', 'project_id', 'asset_type'] as const)(
      'refuses an existing object with mismatched %s',
      async (field) => {
        const f = fixture(kind);
        f.state.asset = {
          ...f.committed,
          [field]:
            field === 'asset_type'
              ? kind === 'REFERENCE_IMAGE'
                ? 'FINAL_VIDEO'
                : 'REFERENCE_IMAGE'
              : 'bbbbbbbb-0000-4000-8000-00000000000b',
        };
        expect(await f.confirm()).toMatchObject({ ok: false, code: 'CONFLICT' });
        expect(f.state.writes).toBe(0);
        expect(f.remove).not.toHaveBeenCalled();
      },
    );

    it('rejects a foreign Storage path without deletion', async () => {
      const f = fixture(kind);
      expect(await f.confirm({ storagePath: `someone-else/${PROJECT}/upload` })).toMatchObject({
        ok: false,
        code: 'FORBIDDEN',
      });
      expect(f.state.writes).toBe(0);
      expect(f.remove).not.toHaveBeenCalled();
    });

    it('rejects invalid media without deleting an object another request might have confirmed', async () => {
      const f = fixture(kind);
      f.info.mockResolvedValue({
        data: { size: 0, contentType: 'application/octet-stream' },
        error: null,
      });
      expect(await f.confirm()).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(f.state.writes).toBe(0);
      expect(f.remove).not.toHaveBeenCalled();
    });
  },
);
