import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const db = new pg.Client({
  host: process.env.PGHOST ?? '/tmp/avs-verify-pg/socket',
  port: Number(process.env.PGPORT ?? 55432),
  user: 'postgres',
  database: 'postgres',
});
await db.connect();
let passed = 0;
const q = (s, p) => db.query(s, p);
const check = (value, label) => {
  assert.ok(value, label);
  passed++;
};
async function denied(s, p) {
  await q('savepoint refusal');
  let code;
  try {
    await q(s, p);
  } catch (e) {
    code = e.code;
  }
  await q('rollback to savepoint refusal');
  check(['42501', '40001'].includes(code), 'must reject: ' + s);
}
async function actor(who) {
  await q('reset role');
  await q('select avs_test.become($1)', [who]);
}
const owner = 'aaaaaaaa-0000-4000-8000-00000000000a';
async function fixture() {
  await q('reset role');
  await q("select set_config('request.jwt.claims','',true)");
  const id = randomUUID();
  await q(
    "insert into public.projects(id,user_id,status,brief,orientation,submitted_at) values($1,$2,'FINALISING','A complete fixture brief for authoritative final release security.','VERTICAL_9_16',now())",
    [id, owner],
  );
  return id;
}
async function upload(id) {
  await q('reset role');
  const path = owner + '/' + id + '/final-v1-' + randomUUID() + '.mp4';
  await q(
    "insert into storage.objects(bucket_id,name,metadata) values('project-deliveries',$1,jsonb_build_object('size',100,'mimetype','video/mp4'))",
    [path],
  );
  return path;
}
async function confirm(id, path) {
  await actor('admin');
  return (
    await q(
      "select public.record_delivery_asset($1,'FINAL_VIDEO',$2,'video/mp4','test.mp4',100) result",
      [id, path],
    )
  ).rows[0].result;
}
async function release(id, asset) {
  await actor('admin');
  return (await q('select public.release_final_video($1,$2) result', [id, asset])).rows[0].result;
}
try {
  await q('begin');
  const fabricated = await fixture();
  await actor('admin');
  const fake = (
    await q(
      "insert into project_assets(project_id,user_id,asset_type,storage_bucket,storage_path,mime_type,file_size) values($1,$2,'FINAL_VIDEO','project-deliveries',$3,'video/mp4',100) returning id",
      [fabricated, owner, owner + '/' + fabricated + '/row-only.mp4'],
    )
  ).rows[0].id;
  await denied('select public.release_final_video($1,$2)', [fabricated, fake]);
  await denied(
    'insert into final_delivery.releases(project_id,asset_id,released_by) values($1,$2,$3)',
    [fabricated, fake, owner],
  );
  const invalid = await fixture(),
    invalidPath = await upload(invalid);
  await actor('admin');
  await denied(
    "select public.record_delivery_asset($1,'FINAL_VIDEO',$2,'video/webm','fake.webm',100)",
    [invalid, invalidPath],
  );
  check(
    (await q('select id from project_assets where project_id=$1', [invalid])).rowCount === 0,
    'invalid confirmation leaves no asset',
  );
  const atomic = await fixture(),
    atomicPath = await upload(atomic),
    atomicAsset = await confirm(atomic, atomicPath);
  await q('reset role');
  await q(
    "create function avs_test.reject_final_notice() returns trigger language plpgsql as $$ begin raise exception 'Injected test failure' using errcode='42501'; end $$",
  );
  await q(
    "create trigger blocker2_test_failure before insert on notification_outbox for each row when(new.event_type='FINAL_VIDEO_READY_CUSTOMER') execute function avs_test.reject_final_notice()",
  );
  await actor('admin');
  await denied('select public.release_final_video($1,$2)', [atomic, atomicAsset.assetId]);
  await q('reset role');
  check(
    (await q('select asset_id from final_delivery.releases where project_id=$1', [atomic]))
      .rowCount === 0,
    'enqueue failure rolls back release binding',
  );
  check(
    (await q('select status from projects where id=$1', [atomic])).rows[0].status === 'FINALISING',
    'enqueue failure rolls back completion',
  );
  await q('drop trigger blocker2_test_failure on notification_outbox');
  const id = await fixture(),
    path = await upload(id);
  await actor('customer_a');
  await q("select set_config('storage.operation','storage.object.get_authenticated',true)");
  check(
    (await q('select id from storage.objects where name=$1', [path])).rowCount === 0,
    'object alone inaccessible',
  );
  await denied('select public.release_final_video($1,$2)', [id, randomUUID()]);
  const a = await confirm(id, path);
  check(a.status === 'FINALISING', 'confirmation does not release');
  check((await confirm(id, path)).assetId === a.assetId, 'confirmation replay same asset');
  await denied("update public.projects set status='COMPLETED' where id=$1", [id]);
  await actor('customer_a');
  check(
    (await q('select id from public.project_assets where id=$1', [a.assetId])).rowCount === 0,
    'unreleased asset row hidden',
  );
  check(
    (await q('select id from storage.objects where name=$1', [path])).rowCount === 0,
    'confirmed object hidden before release',
  );
  await actor('admin');
  await denied('select public.release_final_video($1,$2)', [id, randomUUID()]);
  await denied("update storage.objects set name=name||'x' where name=$1", [path]);
  await q('savepoint lost_transaction');
  await release(id, a.assetId);
  await q('rollback to savepoint lost_transaction');
  check(
    (await q('select status from public.projects where id=$1', [id])).rows[0].status ===
      'FINALISING',
    'rolled back release leaves finalising',
  );
  await q('reset role');
  check(
    (await q('select id from notification_outbox where project_id=$1', [id])).rowCount === 0,
    'rollback has no notification',
  );
  await release(id, a.assetId);
  check(
    (await release(id, a.assetId)).assetId === a.assetId,
    'lost response replay returns same release',
  );
  await q('reset role');
  check(
    (
      await q(
        "select id from notification_outbox where project_id=$1 and event_type='FINAL_VIDEO_READY_CUSTOMER'",
        [id],
      )
    ).rowCount === 1,
    'exactly one completion notification',
  );
  await actor('customer_a');
  check(
    (await q('select id from public.project_assets where id=$1', [a.assetId])).rowCount === 1,
    'released asset visible',
  );
  check(
    (await q('select id from storage.objects where name=$1', [path])).rowCount === 1,
    'authenticated exact final accessible',
  );
  for (const operation of ['object.get_authenticated_info', 'object.head_authenticated_info']) {
    await q("select set_config('storage.operation',$1,true)", [operation]);
    check(
      (await q('select id from storage.objects where name=$1', [path])).rowCount === 1,
      'released final accessible during hosted Storage metadata operation: ' + operation,
    );
  }
  await q("select set_config('storage.operation','storage.object.sign',true)");
  check(
    (await q('select id from storage.objects where name=$1', [path])).rowCount === 0,
    'customer cannot mint final bearer URL',
  );
  await actor('admin');
  check(
    (await q('select id from storage.objects where name=$1', [path])).rowCount === 0,
    'admin cannot mint final bearer URL',
  );
  await actor('customer_b');
  await q("select set_config('storage.operation','storage.object.get_authenticated',true)");
  check(
    (await q('select id from storage.objects where name=$1', [path])).rowCount === 0,
    'cross customer read blocked',
  );
  const two = await fixture(),
    p1 = await upload(two),
    p2 = await upload(two);
  const f1 = await confirm(two, p1),
    f2 = await confirm(two, p2);
  await denied('select public.release_final_video($1,$2)', [two, f1.assetId]);
  await denied('select public.release_final_video($1,$2)', [two, a.assetId]);
  await release(two, f2.assetId);
  await denied('select public.release_final_video($1,$2)', [two, f1.assetId]);
  await actor('customer_a');
  check(
    (await q('select id from public.project_assets where project_id=$1', [two])).rowCount === 1,
    'only exact released final visible',
  );
  check(
    (await q('select id from storage.objects where name=$1', [p1])).rowCount === 0,
    'superseded final inaccessible',
  );
  await q('reset role');
  await q("select set_config('request.jwt.claims','',true)");
  await q("select operator_maintenance.prepare_project($1,'blocker2-test','ERASURE')", [id]);
  await q(
    "select set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true)",
  );
  await q('delete from storage.objects where name=$1', [path]);
  await q('select operator_maintenance.record_storage_deletion($1,$2,$3)', [
    id,
    'project-deliveries',
    path,
  ]);
  await q('select operator_maintenance.finish_project($1)', [id]);
  check(
    (await q('select 1 from final_delivery.releases where project_id=$1', [id])).rowCount === 0,
    'erasure removes release ledger',
  );
  check(
    (await q('select 1 from public.project_assets where id=$1', [a.assetId])).rowCount === 0,
    'erasure removes final asset',
  );
  console.log('Blocker 2 native assertions passed: ' + passed);
  await q('rollback');
} catch (e) {
  await q('rollback');
  console.error('Blocker 2 failure', e.code ?? e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}

// Independent native connections exercise both serialization orders.
const cfg = {
  host: process.env.PGHOST ?? '/tmp/avs-verify-pg/socket',
  port: Number(process.env.PGPORT ?? 55432),
  user: 'postgres',
  database: 'postgres',
};
const setup = new pg.Client(cfg),
  left = new pg.Client(cfg),
  right = new pg.Client(cfg);
let races = 0;
async function tx(c, role = 'admin') {
  await c.query('begin');
  await c.query('select avs_test.become($1)', [role]);
  await c.query("set local lock_timeout='250ms'");
}
async function reject(c, sql, args, code) {
  await c.query('savepoint attempt');
  let actual;
  try {
    await c.query(sql, args);
  } catch (e) {
    actual = e.code;
  }
  await c.query('rollback to savepoint attempt');
  assert.equal(actual, code);
  races++;
}
const rec =
  "select public.record_delivery_asset($1,'FINAL_VIDEO',$2,'video/mp4','final.mp4',100) r";
const rel = 'select public.release_final_video($1,$2) r';
async function make() {
  const id = randomUUID(),
    paths = [1, 2].map((v) => owner + '/' + id + '/final-v' + v + '-' + randomUUID() + '.mp4');
  await setup.query(
    "insert into projects(id,user_id,status,brief,orientation,submitted_at) values($1,$2,'FINALISING','A complete concurrent final release test fixture brief.','VERTICAL_9_16',now())",
    [id, owner],
  );
  for (const path of paths)
    await setup.query(
      "insert into storage.objects(bucket_id,name,metadata) values('project-deliveries',$1,jsonb_build_object('size',100,'mimetype','video/mp4'))",
      [path],
    );
  await tx(left);
  const one = (await left.query(rec, [id, paths[0]])).rows[0].r.assetId;
  await left.query('commit');
  return { id, paths, one };
}
try {
  await Promise.all([setup.connect(), left.connect(), right.connect()]);
  // Release wins versus confirmation; waiting confirm cannot land after completion.
  let f = await make();
  await tx(left);
  await left.query(rel, [f.id, f.one]);
  await tx(right);
  await reject(right, rec, [f.id, f.paths[1]], '55P03');
  await left.query('commit');
  await reject(right, rec, [f.id, f.paths[1]], '42501');
  await right.query('rollback');
  // Confirmation wins; stale final selection must fail after waiting.
  f = await make();
  await tx(left);
  const _two = (await left.query(rec, [f.id, f.paths[1]])).rows[0].r.assetId;
  await tx(right);
  await reject(right, rel, [f.id, f.one], '55P03');
  await left.query('commit');
  await reject(right, rel, [f.id, f.one], '40001');
  await right.query('rollback');
  // Duplicate confirmation waits then converges on the same authoritative row.
  f = await make();
  await tx(left);
  const concurrentFinal = (await left.query(rec, [f.id, f.paths[1]])).rows[0].r.assetId;
  await tx(right);
  await reject(right, rec, [f.id, f.paths[1]], '55P03');
  await left.query('commit');
  assert.equal((await right.query(rec, [f.id, f.paths[1]])).rows[0].r.assetId, concurrentFinal);
  races++;
  await right.query('commit');
  // Duplicate release, plus a losing competing identity.
  await tx(left);
  await left.query(rel, [f.id, concurrentFinal]);
  await tx(right);
  await reject(right, rel, [f.id, concurrentFinal], '55P03');
  await left.query('commit');
  assert.equal(
    (await right.query(rel, [f.id, concurrentFinal])).rows[0].r.assetId,
    concurrentFinal,
  );
  races++;
  await reject(right, rel, [f.id, f.one], '40001');
  await right.query('commit');
  // Customer sees no uncommitted release; after commit, sees exactly the bound asset.
  f = await make();
  await tx(left);
  await left.query(rel, [f.id, f.one]);
  await tx(right, 'customer_a');
  assert.equal(
    (await right.query('select id from project_assets where id=$1', [f.one])).rowCount,
    0,
  );
  races++;
  await left.query('commit');
  assert.equal(
    (await right.query('select id from project_assets where id=$1', [f.one])).rowCount,
    1,
  );
  races++;
  await right.query('commit');
  // Erasure wins; release waits and then rejects the retired project.
  f = await make();
  await left.query('begin');
  await left.query("select set_config('request.jwt.claims','',true)");
  await left.query("select operator_maintenance.prepare_project($1,'B2_RACE','ERASURE')", [f.id]);
  await tx(right);
  await reject(right, rel, [f.id, f.one], '55P03');
  await left.query('commit');
  await reject(right, rel, [f.id, f.one], '42501');
  await right.query('rollback');
  // Release wins; erasure waits, then still freezes the released project.
  f = await make();
  await tx(left);
  await left.query(rel, [f.id, f.one]);
  await right.query('begin');
  await right.query("select set_config('request.jwt.claims','',true)");
  await right.query("set local lock_timeout='250ms'");
  await reject(
    right,
    "select operator_maintenance.prepare_project($1,'B2_RACE','ERASURE')",
    [f.id],
    '55P03',
  );
  await left.query('commit');
  await right.query("select operator_maintenance.prepare_project($1,'B2_RACE','ERASURE')", [f.id]);
  await right.query('commit');
  races++;
  // Status mutation wins; a cancelled project cannot release.
  f = await make();
  await tx(left);
  await left.query("update projects set status='CANCELLED' where id=$1", [f.id]);
  await tx(right);
  await reject(right, rel, [f.id, f.one], '55P03');
  await left.query('commit');
  await reject(right, rel, [f.id, f.one], '42501');
  await right.query('rollback');
  // Release wins; mutation cannot reopen or cancel the delivered project.
  f = await make();
  await tx(left);
  await left.query(rel, [f.id, f.one]);
  await tx(right);
  await reject(right, "update projects set status='CANCELLED' where id=$1", [f.id], '55P03');
  await left.query('commit');
  await reject(right, "update projects set status='CANCELLED' where id=$1", [f.id], '42501');
  await right.query('rollback');
  console.log('Blocker 2 concurrent assertions passed: ' + races);
} catch (e) {
  console.error('Blocker 2 concurrency failure', e.code ?? e.message);
  process.exitCode = 1;
} finally {
  await Promise.all([left.query('rollback'), right.query('rollback')]);
  await Promise.all([setup.end(), left.end(), right.end()]);
}
