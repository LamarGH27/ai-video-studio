import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

export function validateTarget(env, expectedRef) {
  if (!/^[a-z0-9]{20}$/.test(expectedRef || ''))
    throw new Error('Expected project reference required');
  const api = new URL(env.NEXT_PUBLIC_SUPABASE_URL),
    db = new URL(env.DATABASE_URL);
  if (
    api.protocol !== 'https:' ||
    api.hostname !== expectedRef + '.supabase.co' ||
    api.username ||
    api.password ||
    api.pathname !== '/' ||
    api.search ||
    api.hash
  )
    throw new Error('API target mismatch');
  if (!(
    (db.hostname === 'db.' + expectedRef + '.supabase.co' && db.username === 'postgres') ||
    (db.hostname.endsWith('.pooler.supabase.com') &&
      decodeURIComponent(db.username) === 'postgres.' + expectedRef)
  ))
    throw new Error('Database target mismatch');
  if (!env.SUPABASE_SECRET_KEY) throw new Error('Operator Storage credential required');
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) db.searchParams.delete(key);
  return { api: api.origin, database: db.href };
}
export async function eraseProject(db, storage, { projectId, caseId, purpose }) {
  await db.query('select operator_maintenance.prepare_project($1,$2,$3)', [
    projectId,
    caseId,
    purpose,
  ]);
  const rows = (
    await db.query(
      'select bucket_id,object_name,deleted_at from operator_maintenance.erasure_objects where project_id=$1 order by bucket_id,object_name',
      [projectId],
    )
  ).rows;
  for (const row of rows) {
    if (row.deleted_at) continue;
    if (
      !['reference-images', 'project-deliveries'].includes(row.bucket_id) ||
      row.object_name.split('/')[1] !== projectId
    )
      throw new Error('Manifest scope mismatch');
    // No automatic destructive retry loop: resume the same durable manifest.
    const { error } = await storage.from(row.bucket_id).remove([row.object_name]);
    if (error) throw new Error('Storage deletion failed; job remains frozen and resumable');
    await db.query('select operator_maintenance.record_storage_deletion($1,$2,$3)', [
      projectId,
      row.bucket_id,
      row.object_name,
    ]);
  }
  await db.query('select operator_maintenance.finish_project($1)', [projectId]);
  return { objects: rows.length, phase: 'COMPLETE' };
}
export async function main(args = process.argv.slice(2)) {
  const { values: v } = parseArgs({
    args,
    options: {
      'env-file': { type: 'string' },
      'expected-project-ref': { type: 'string' },
      project: { type: 'string' },
      account: { type: 'string' },
      case: { type: 'string' },
      purpose: { type: 'string' },
      execute: { type: 'boolean', default: false },
    },
  });
  if (
    !v['env-file'] ||
    !v.case ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(v.case) ||
    !['ERASURE', 'RETENTION', 'OPERATOR_DELETION'].includes(v.purpose) ||
    Boolean(v.project) === Boolean(v.account)
  )
    throw new Error('Explicit env file, project OR account, opaque case and purpose required');
  const target = v.project || v.account;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(target))
    throw new Error('Invalid target UUID');
  const env = parse(readFileSync(resolve(v['env-file'])));
  const cfg = validateTarget(env, v['expected-project-ref']);
  const db = new pg.Client({
    connectionString: cfg.database,
    ssl: {
      rejectUnauthorized: true,
      ...(env.PGSSLROOTCERT ? { ca: readFileSync(env.PGSSLROOTCERT, 'utf8') } : {}),
    },
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    lock_timeout: 5000,
  });
  await db.connect();
  try {
    const role = (await db.query('select current_user as name')).rows[0].name;
    if (role !== 'postgres')
      throw new Error('Use the approved direct operator database connection');
    if (!v.execute) {
      const projects = (
        await db.query(
          'select id from public.projects where ' + (v.project ? 'id' : 'user_id') + '=$1',
          [target],
        )
      ).rows;
      const inventory = (
        await db.query(
          'select bucket_id,count(*)::int as objects from storage.objects where ' +
            (v.project ? "split_part(name,'/',2)" : "split_part(name,'/',1)") +
            '=$1 group by bucket_id',
          [target],
        )
      ).rows;
      console.log(
        JSON.stringify({
          mode: 'PLAN_ONLY',
          projects: projects.length,
          inventory,
          approvalCase: v.case,
        }),
      );
      return;
    }
    const api = createClient(cfg.api, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60000) }) },
    });
    if (v.project) {
      console.log(
        JSON.stringify(
          await eraseProject(db, api.storage, {
            projectId: target,
            caseId: v.case,
            purpose: v.purpose,
          }),
        ),
      );
      return;
    }
    const ids = (
      await db.query('select operator_maintenance.prepare_account($1,$2) as ids', [target, v.case])
    ).rows[0].ids;
    for (const id of ids)
      await eraseProject(db, api.storage, { projectId: id, caseId: v.case, purpose: v.purpose });
    await db.query('select operator_maintenance.account_ready($1,$2)', [target, v.case]);
    const present = (
      await db.query('select exists(select 1 from auth.users where id=$1) as present', [target])
    ).rows[0].present;
    if (present) {
      const { error } = await api.auth.admin.deleteUser(target);
      if (error) throw new Error('Auth deletion failed; resume approved account job');
    }
    await db.query('select operator_maintenance.finish_account($1,$2)', [target, v.case]);
    console.log(JSON.stringify({ phase: 'COMPLETE', projects: ids.length }));
  } finally {
    await db.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(
      'Erasure stopped safely; inspect the restricted job and retry the same case. Code: ' +
        (/^[A-Z0-9]{5}$/.test(e.code || '') ? e.code : 'OPERATOR_CHECK_FAILED'),
    );
    process.exitCode = 1;
  });
