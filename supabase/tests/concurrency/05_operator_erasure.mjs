import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const cfg = {
  host: process.env.PGHOST || '/tmp/avs-verify-pg/socket',
  port: Number(process.env.PGPORT || 55432),
  user: 'postgres',
  database: 'postgres',
};
const db = new pg.Client(cfg),
  a = new pg.Client(cfg),
  b = new pg.Client(cfg);
let n = 0;
const owner = 'aaaaaaaa-0000-4000-8000-00000000000a';
const prep = "select operator_maintenance.prepare_project($1,'TEST_ERASURE','ERASURE')";
async function eq(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  n++;
  console.log('PASS B1 ' + label);
}
async function deny(c, label, sql, args, code = '42501') {
  let got;
  await c.query('savepoint probe');
  try {
    await c.query(sql, args);
    got = 'OK';
  } catch (e) {
    got = e.code;
    await c.query('rollback to probe');
  }
  await c.query('release probe');
  await eq(label, got, code);
}
async function begin(c, role) {
  await c.query('begin');
  if (role) await c.query('select avs_test.become($1)', [role]);
  await c.query("set local lock_timeout='300ms'");
}
async function fixture(state = 'DRAFT') {
  const id = randomUUID(),
    path = owner + '/' + id + '/ref.jpg';
  await db.query(
    "insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds,submitted_at) values($1,$2,$3::public.project_status,'A complete native erasure regression brief.','VERTICAL_9_16',15,case when $3::public.project_status='DRAFT' then null else now() end)",
    [id, owner, state],
  );
  if (state === 'DRAFT')
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('reference-images',$1,jsonb_build_object('mimetype','image/jpeg','size',1000))",
      [path],
    );
  if (state === 'DRAFT')
    await db.query("update storage.objects set created_at=now()-interval '2 hours' where name=$1", [
      path,
    ]);
  return { id, path };
}
try {
  await Promise.all([db.connect(), a.connect(), b.connect()]);
  assert.equal(
    (await db.query("select to_regnamespace('avs_test') is not null as ok")).rows[0].ok,
    true,
  );
  const f = await fixture();
  for (const role of ['customer_a', 'admin']) {
    await begin(a, role);
    await deny(a, role + ' cannot prepare erasure', prep, [f.id]);
    await a.query('rollback');
  }
  await begin(a);
  await a.query('set local role service_role');
  await deny(a, 'service role cannot prepare erasure', prep, [f.id]);
  await a.query('rollback');
  await db.query(prep, [f.id]);
  await db.query(prep, [f.id]);
  await eq(
    'prepare replay one manifest',
    (
      await db.query(
        'select count(*)::int n from operator_maintenance.erasure_objects where project_id=$1',
        [f.id],
      )
    ).rows[0].n,
    1,
  );
  await begin(a);
  await deny(
    a,
    'cannot finalize undeleted Storage',
    'select operator_maintenance.finish_project($1)',
    [f.id],
    '55000',
  );
  await deny(
    a,
    'cannot receipt extant object',
    "select operator_maintenance.record_storage_deletion($1,'reference-images',$2)",
    [f.id, f.path],
    '55000',
  );
  await a.query('rollback');
  await begin(a, 'customer_a');
  await eq(
    'customer cannot see frozen project',
    (await a.query('select id from public.projects where id=$1', [f.id])).rowCount,
    0,
  );
  await eq(
    'customer cannot delete frozen object',
    (
      await a.query("delete from storage.objects where bucket_id='reference-images' and name=$1", [
        f.path,
      ])
    ).rowCount,
    0,
  );
  await a.query('rollback');
  await begin(a);
  await a.query(
    "select set_config('request.jwt.claims',json_build_object('role','service_role')::text,true)",
  );
  await a.query('set local role service_role');
  await eq(
    'narrow service deletion allowed',
    (
      await a.query("delete from storage.objects where bucket_id='reference-images' and name=$1", [
        f.path,
      ])
    ).rowCount,
    1,
  );
  await deny(
    a,
    'reuse path blocked',
    "insert into storage.objects(bucket_id,name,metadata) values('reference-images',$1,'{}')",
    [f.path],
  );
  await a.query('commit');
  await db.query("select operator_maintenance.record_storage_deletion($1,'reference-images',$2)", [
    f.id,
    f.path,
  ]);
  await db.query('select operator_maintenance.finish_project($1)', [f.id]);
  await db.query('select operator_maintenance.finish_project($1)', [f.id]);
  await eq(
    'finished project absent',
    (await db.query('select id from public.projects where id=$1', [f.id])).rowCount,
    0,
  );
  await eq(
    'tombstone retained',
    (
      await db.query(
        'select phase from operator_maintenance.project_erasures where project_id=$1',
        [f.id],
      )
    ).rows[0].phase,
    'COMPLETE',
  );
  const operations = [
    [
      'confirmation',
      'DRAFT',
      'customer_a',
      (f) => ["select public.confirm_reference_asset($1,$2,'reference.jpg')", [f.id, f.path]],
    ],
    [
      'submission',
      'DRAFT',
      'customer_a',
      (f) => ['select public.submit_project($1,true,true,false)', [f.id]],
    ],
    [
      'revision',
      'IN_PRODUCTION',
      'customer_a',
      (f) => [
        "select public.request_project_revision($1,$2,'Please change the opening sequence for this erasure test.')",
        [f.id, f.preview],
      ],
    ],
    [
      'final upload',
      'FINALISING',
      'admin',
      (f) => [
        "select public.record_delivery_asset($1,'FINAL_VIDEO',$2,'video/mp4','final.mp4',1000)",
        [f.id, owner + '/' + f.id + '/final.mp4'],
      ],
    ],
    [
      'orphan cleanup',
      'DRAFT',
      'customer_a',
      (f) => ['select public.claim_reference_orphans($1,$2::text[])', [f.id, [f.path]]],
    ],
    [
      'status change',
      'ASSETS_REVIEW',
      'admin',
      (f) => ["update public.projects set status='IN_PRODUCTION' where id=$1", [f.id]],
    ],
  ];
  async function prepareOperation(label, state) {
    const f = await fixture(state);
    if (label === 'submission') {
      await begin(a, 'customer_a');
      await a.query("select public.confirm_reference_asset($1,$2,'ref.jpg')", [f.id, f.path]);
      await a.query('commit');
    }
    if (label === 'revision') {
      await begin(a, 'admin');
      f.preview = (
        await a.query(
          "select public.record_delivery_asset($1,'PREVIEW_VIDEO',$2,'video/mp4','one.mp4',1000) as result",
          [f.id, owner + '/' + f.id + '/one.mp4'],
        )
      ).rows[0].result.assetId;
      await a.query('commit');
    }
    return f;
  }
  for (const [label, state, role, make] of operations) {
    const g = await prepareOperation(label, state);
    await begin(a);
    await a.query(prep, [g.id]);
    await begin(b, role);
    const [sql, args] = make(g);
    await deny(b, label + ' waits for erasure lock', sql, args, '55P03');
    await a.query('commit');
    if (label === 'status change')
      await eq('status update hidden after erasure', (await b.query(sql, args)).rowCount, 0);
    else await deny(b, label + ' blocked after erasure', sql, args);
    await b.query('rollback');
    const h = await prepareOperation(label, state);
    await begin(a, role);
    const [firstSql, firstArgs] = make(h);
    await a.query(firstSql, firstArgs);
    await begin(b);
    await deny(b, 'erasure waits for actual ' + label, prep, [h.id], '55P03');
    await a.query('commit');
    await b.query(prep, [h.id]);
    await b.query('commit');
    await eq(
      label + ' first, then erasure consistently frozen',
      (
        await db.query(
          'select phase from operator_maintenance.project_erasures where project_id=$1',
          [h.id],
        )
      ).rows[0].phase,
      'DELETING',
    );
    if (label === 'confirmation' || label === 'final upload')
      await eq(
        label + ' committed asset captured',
        (
          await db.query(
            'select count(*)::int n from operator_maintenance.erasure_objects where project_id=$1',
            [h.id],
          )
        ).rows[0].n,
        1,
      );
    if (label === 'orphan cleanup')
      await eq(
        'H2 claim survives erasure prepare',
        (
          await db.query(
            'select count(*)::int n from public.reference_orphan_claims where project_id=$1',
            [h.id],
          )
        ).rows[0].n,
        1,
      );
  }
  // Dedicated account, never freeze the shared regression principals.
  const uid = randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [
    uid,
    uid + '@example.invalid',
  ]);
  await db.query("select operator_maintenance.prepare_account($1,'ACCOUNT_CASE')", [uid]);
  await begin(a);
  await deny(
    a,
    'new project blocked for retired account',
    'insert into public.projects(user_id) values($1)',
    [uid],
  );
  await deny(
    a,
    'new delivery namespace blocked for retired account',
    "insert into storage.objects(bucket_id,name) values('project-deliveries',$1)",
    [uid + '/' + randomUUID() + '/late.mp4'],
  );
  await deny(
    a,
    'cannot complete extant account',
    "select operator_maintenance.finish_account($1,'ACCOUNT_CASE')",
    [uid],
    '55000',
  );
  await a.query('rollback');
  await db.query("select operator_maintenance.account_ready($1,'ACCOUNT_CASE')", [uid]);
  await db.query('delete from auth.users where id=$1', [uid]);
  await db.query("select operator_maintenance.finish_account($1,'ACCOUNT_CASE')", [uid]);
  await db.query("select operator_maintenance.prepare_account($1,'ACCOUNT_CASE')", [uid]);
  await eq(
    'account completion replay retained',
    (
      await db.query(
        'select completed_at is not null ok from operator_maintenance.account_erasures where user_id=$1',
        [uid],
      )
    ).rows[0].ok,
    true,
  );
  console.log('B1 assertions passed: ' + n);
} finally {
  for (const c of [b, a, db]) {
    await c.query('rollback').catch(() => {});
    await c.end();
  }
}
