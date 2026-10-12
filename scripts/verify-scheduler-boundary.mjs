// Negative boundary probes; stop on exposure drift. No privileged API key is used.
import fs from 'node:fs';
import cp from 'node:child_process';
import { parse } from 'dotenv';
const [file, ref, scheduler = 'production_scheduler'] = process.argv.slice(2);
if (!file || !ref || !['staging_scheduler', 'production_scheduler'].includes(scheduler))
  throw Error(
    'Usage: node scripts/verify-scheduler-boundary.cjs ENV_FILE PROJECT_REF [scheduler_schema]',
  );
const env = parse(fs.readFileSync(file));
const base = env.NEXT_PUBLIC_SUPABASE_URL,
  key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (new URL(base).hostname !== ref + '.supabase.co') throw Error('Target mismatch');
let jwt;
const rows = [];
async function call(path, body, schema) {
  const method = body === undefined ? 'GET' : 'POST';
  const res = await fetch(base + path, {
    method,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}),
      ...(schema ? { [method === 'GET' ? 'Accept-Profile' : 'Content-Profile']: schema } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}
async function main() {
  // Check exact currently configured secret values without printing matches.
  if (!env.CRON_SECRET) throw Error('CRON_SECRET is required for source-secret verification');
  const names = ['CRON_SECRET', 'DATABASE_URL', 'SUPABASE_SECRET_KEY', 'RESEND_API_KEY'];
  const files = cp
    .execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .toString()
    .split('\0')
    .filter(Boolean);
  for (const f of files) {
    if (/(^|\/)\.env(?:\.|$)/.test(f) && !f.endsWith('.example'))
      throw Error('Non-ignored environment file');
    const b = fs.readFileSync(f);
    for (const n of names)
      if (env[n] && b.includes(Buffer.from(env[n])))
        throw Error('Configured secret found in source');
  }
  for (const principal of ['anon', 'customer', 'admin']) {
    jwt = undefined;
    if (principal !== 'anon') {
      const prefix = principal === 'customer' ? 'E2E_CUSTOMER_A' : 'E2E_ADMIN';
      const a = await call('/auth/v1/token?grant_type=password', {
        email: env[prefix + '_EMAIL'],
        password: env[prefix + '_PASSWORD'],
      });
      if (a.status !== 200 || !a.data?.access_token) throw Error(principal + ' sign-in failed');
      jwt = a.data.access_token;
      const p = await call(
        '/rest/v1/profiles?select=role&id=eq.' + a.data.user.id,
        undefined,
        'public',
      );
      if (p.status !== 200 || p.data?.[0]?.role !== principal)
        throw Error(principal + ' role control failed');
    }
    const id = '00000000-0000-0000-0000-000000000000';
    const tests = [
      [
        'net',
        'rpc/http_get',
        { url: base + '/auth/v1/health', params: {}, headers: {}, timeout_milliseconds: 1000 },
      ],
      [
        'net',
        'rpc/http_post',
        {
          url: base + '/auth/v1/health',
          body: {},
          params: {},
          headers: {},
          timeout_milliseconds: 1000,
        },
      ],
      ['net', 'http_request_queue?select=*&limit=1'],
      ['net', '_http_response?select=*&limit=1'],
      ['cron', 'rpc/unschedule', { job_id: -1 }],
      ['cron', 'rpc/alter_job', { job_id: -1, schedule: '*/5 * * * *' }],
      [
        'cron',
        'rpc/schedule',
        { job_name: 'boundary-probe-must-not-exist', schedule: '0 0 31 2 *', command: 'select 1' },
      ],
      ['cron', 'job?select=jobid&limit=1'],
      ['vault', 'secrets?select=id,name&limit=1'],
      ['vault', 'decrypted_secrets?select=decrypted_secret&limit=1'],
      [scheduler, 'rpc/invoke', { p_origin: 'manual' }],
      ['public', 'rpc/claim_notifications', { p_limit: 0, p_lease_seconds: 300 }],
      [
        'public',
        'rpc/mark_notification_sent',
        { p_id: id, p_claim_token: id, p_provider_message_id: null },
      ],
      [
        'public',
        'rpc/mark_notification_failed',
        { p_id: id, p_claim_token: id, p_error: 'BOUNDARY_NEGATIVE', p_permanent: false },
      ],
      [
        'public',
        'rpc/enqueue_notification',
        {
          p_event_type: null,
          p_recipient: null,
          p_project_id: id,
          p_dedupe_key: 'BOUNDARY_NEGATIVE',
          p_payload: {},
        },
      ],
    ];
    for (const [schema, path, body] of tests) {
      const x = await call('/rest/v1/' + path, body, schema);
      const expected = schema === 'public' ? '42501' : 'PGRST106';
      const ok =
        x.data?.code === expected &&
        x.status === (schema === 'public' ? (principal === 'anon' ? 401 : 403) : 406);
      rows.push({ principal, schema, path, status: x.status, code: x.data?.code, ok });
      if (!ok) throw Error('Boundary drift: ' + principal + ' ' + schema + ' ' + path);
    }
  }
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      passed: rows.length,
      sourceSecretCheck: 'passed',
      results: rows,
    }),
  );
}
main().catch((e) => {
  console.error(JSON.stringify({ failed: true, reason: e.message, completed: rows.length }));
  process.exitCode = 1;
});
