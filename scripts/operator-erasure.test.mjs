import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraseProject, validateTarget } from './operator-erasure.mjs';
const projectId = '11111111-1111-4111-8111-111111111111';
function fixture({
  failDelete = false,
  failReceipt = false,
  already = false,
  bucket = 'reference-images',
  path = 'owner/' + projectId + '/ref.jpg',
} = {}) {
  const calls = [];
  const row = { bucket_id: bucket, object_name: path, deleted_at: already ? 'confirmed' : null };
  return {
    calls,
    db: {
      async query(sql, _args) {
        calls.push(sql.split('(')[0]);
        if (sql.startsWith('select bucket')) return { rows: [row] };
        if (failReceipt && sql.includes('record_storage_deletion'))
          throw Error('ambiguous DB failure');
        return { rows: [] };
      },
    },
    storage: {
      from() {
        return {
          async remove() {
            calls.push('storage.remove');
            return { error: failDelete ? {} : null };
          },
        };
      },
    },
  };
}
const opts = { projectId, caseId: 'CASE_TEST', purpose: 'ERASURE' };
test('deletes before receipt and database finalization', async () => {
  const f = fixture();
  assert.deepEqual(await eraseProject(f.db, f.storage, opts), { objects: 1, phase: 'COMPLETE' });
  assert.ok(
    f.calls.indexOf('storage.remove') <
      f.calls.indexOf('select operator_maintenance.record_storage_deletion'),
  );
  assert.equal(f.calls.at(-1), 'select operator_maintenance.finish_project');
});
test('Storage error leaves DB unfinalized', async () => {
  const f = fixture({ failDelete: true });
  await assert.rejects(eraseProject(f.db, f.storage, opts));
  assert.ok(
    !f.calls.some((c) => c.includes('record_storage_deletion') || c.includes('finish_project')),
  );
});
test('receipt failure never finalizes potentially incomplete job', async () => {
  const f = fixture({ failReceipt: true });
  await assert.rejects(eraseProject(f.db, f.storage, opts));
  assert.ok(!f.calls.some((c) => c.includes('finish_project')));
});
test('resume skips persisted deletion receipt', async () => {
  const f = fixture({ already: true });
  await eraseProject(f.db, f.storage, opts);
  assert.ok(!f.calls.includes('storage.remove'));
  assert.equal(f.calls.at(-1), 'select operator_maintenance.finish_project');
});
test('manifest cannot target a different project', async () => {
  const f = fixture({ path: 'owner/other/ref.jpg' });
  await assert.rejects(eraseProject(f.db, f.storage, opts));
  assert.ok(!f.calls.includes('storage.remove'));
});
test('manifest cannot target another bucket', async () => {
  const f = fixture({ bucket: 'other' });
  await assert.rejects(eraseProject(f.db, f.storage, opts));
  assert.ok(!f.calls.includes('storage.remove'));
});
const ref = 'abcdefghijklmnopqrst';
const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://' + ref + '.supabase.co',
  DATABASE_URL: 'postgresql://postgres:example@db.' + ref + '.supabase.co/postgres',
  SUPABASE_SECRET_KEY: 'test-placeholder',
};
test('matching explicit database/API project is accepted', () =>
  assert.equal(validateTarget(env, ref).api, 'https://' + ref + '.supabase.co'));
test('wrong API target fails closed', () =>
  assert.throws(() =>
    validateTarget({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }, ref),
  ));
test('wrong database target fails closed', () =>
  assert.throws(() =>
    validateTarget(
      { ...env, DATABASE_URL: 'postgresql://postgres:example@db.other.supabase.co/postgres' },
      ref,
    ),
  ));
test('pooler lookalike fails closed', () =>
  assert.throws(() =>
    validateTarget(
      {
        ...env,
        DATABASE_URL:
          'postgresql://postgres.' + ref + ':example@pooler.supabase.com.attacker.invalid/postgres',
      },
      ref,
    ),
  ));
test('missing operator Storage key fails closed', () =>
  assert.throws(() => validateTarget({ ...env, SUPABASE_SECRET_KEY: '' }, ref)));
