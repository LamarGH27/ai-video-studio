/* Native PostgreSQL, throwaway avs_test harness only. Real independent sessions
 * force both lock orderings; lock_timeout proves contention, not correctness. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function runH5Concurrency(config) {
  const clients = [];
  let checks = 0;
  const owner = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const record =
    "select public.record_delivery_asset($1,'PREVIEW_VIDEO',$2,'video/mp4','preview.mp4',1000) as asset";
  const request =
    "select public.request_project_revision($1,$2,'Please replace the opening sequence with a different shot.') as revision";
  const ready = "update public.projects set status='PREVIEW_READY' where id=$1";
  const production = "update public.projects set status='IN_PRODUCTION' where id=$1";
  function equal(label, actual, expected) {
    assert.deepEqual(actual, expected, label);
    checks++;
    console.log(`PASS H5 ${label}`);
  }
  async function connect() {
    const c = new pg.Client(config);
    await c.connect();
    clients.push(c);
    return c;
  }
  async function begin(c, role = 'admin') {
    await c.query('begin');
    await c.query('select avs_test.become($1)', [role]);
    await c.query("set local lock_timeout='500ms'");
  }
  async function attempt(c, label, sql, args, expected = 'ok') {
    await c.query('savepoint probe');
    let result,
      code = 'ok';
    try {
      result = await c.query(sql, args);
    } catch (e) {
      code = e.code;
      await c.query('rollback to savepoint probe');
    }
    await c.query('release savepoint probe');
    equal(label, code, expected);
    return result;
  }
  try {
    const db = await connect(),
      a = await connect(),
      b = await connect();
    assert.equal(
      (await db.query("select to_regnamespace('avs_test') is not null as ok")).rows[0].ok,
      true,
    );
    async function fixture(rejected = true) {
      const id = randomUUID();
      await db.query(
        "insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds,submitted_at) values($1,$2,'IN_PRODUCTION','A complete H5 native concurrency fixture production brief.','VERTICAL_9_16',15,now())",
        [id, owner],
      );
      await begin(a);
      const first = (await a.query(record, [id, `${owner}/${id}/one.mp4`])).rows[0].asset.assetId;
      await a.query('commit');
      if (rejected) {
        await begin(a, 'customer_a');
        await a.query(request, [id, first]);
        await a.query('commit');
        await begin(a);
        await a.query(production, [id]);
        await a.query('commit');
      }
      return { id, first, args: [id, `${owner}/${id}/two.mp4`] };
    }
    async function state(f, count, status, revisionStatus, resolvingAsset = null) {
      const row = (
        await db.query(
          `select p.status,
        (select count(*)::int from public.project_assets where project_id=p.id) as assets,
        r.status as revision_status, r.resolved_by_preview_asset_id as resolving_asset,
        (r.resolved_at is not null) as timestamp_present
        from public.projects p left join public.project_revisions r on r.project_id=p.id
        where p.id=$1`,
          [f.id],
        )
      ).rows[0];
      equal('consistent committed project/asset/revision state', row, {
        status,
        assets: count,
        revision_status: revisionStatus,
        resolving_asset: resolvingAsset,
        timestamp_present: revisionStatus === 'RESOLVED',
      });
    }

    // Upload holds the lock first: competing announcement and duplicate RPC
    // wait, then observe the committed replacement. No second insert occurs.
    let f = await fixture();
    await begin(a);
    await begin(b);
    const second = (await a.query(record, f.args)).rows[0].asset.assetId;
    await attempt(b, 'Announcement waits behind replacement', ready, [f.id], '55P03');
    await attempt(b, 'Duplicate confirmation waits behind replacement', record, f.args, '55P03');
    await a.query('commit');
    await attempt(b, 'Announcement after replacement is a safe no-op', ready, [f.id]);
    await attempt(
      b,
      'Duplicate RPC after commit cannot create another asset',
      record,
      f.args,
      '42501',
    );
    await b.query('commit');
    await state(f, 2, 'PREVIEW_READY', 'RESOLVED', second);
    equal(
      'one revised-preview outbox entry',
      (
        await db.query(
          "select count(*)::int as n from public.notification_outbox where project_id=$1 and event_type='PREVIEW_REVISED_CUSTOMER'",
          [f.id],
        )
      ).rows[0].n,
      1,
    );
    const history = (
      await db.query(
        'select resolved_at,updated_at,resolved_by_preview_asset_id from public.project_revisions where project_id=$1',
        [f.id],
      )
    ).rows;
    await begin(a);
    await a.query(ready, [f.id]);
    await a.query('commit');
    equal(
      'repeated announcement leaves resolution unchanged',
      (
        await db.query(
          'select resolved_at,updated_at,resolved_by_preview_asset_id from public.project_revisions where project_id=$1',
          [f.id],
        )
      ).rows,
      history,
    );

    // Status actor owns the row first, before preview recording can proceed.
    f = await fixture();
    await begin(a);
    await begin(b);
    await a.query('select id from public.projects where id=$1 for update', [f.id]);
    await attempt(b, 'Replacement waits for status actor', record, f.args, '55P03');
    await attempt(a, 'Status actor cannot resolve rejected preview', ready, [f.id], '23514');
    await a.query('commit');
    const replacement = (
      await attempt(b, 'Replacement succeeds after rejected announcement', record, f.args)
    ).rows[0].asset.assetId;
    await b.query('commit');
    await state(f, 2, 'PREVIEW_READY', 'RESOLVED', replacement);

    // Different admin uploads race: only the first commits in this stage.
    f = await fixture();
    await begin(a);
    await begin(b);
    const winner = (await a.query(record, f.args)).rows[0].asset.assetId;
    const other = [f.id, `${owner}/${f.id}/competing.mp4`];
    await attempt(b, 'Second admin upload waits', record, other, '55P03');
    await a.query('commit');
    await attempt(b, 'Second admin sees advanced workflow', record, other, '42501');
    await b.query('commit');
    await state(f, 2, 'PREVIEW_READY', 'RESOLVED', winner);

    // Revision request wins the project lock while original preview is ready.
    f = await fixture(false);
    await begin(a, 'customer_a');
    await begin(b);
    await a.query(request, [f.id, f.first]);
    await attempt(b, 'Upload waits for customer request', record, f.args, '55P03');
    await a.query('commit');
    await attempt(b, 'Upload cannot bypass revision-requested stage', record, f.args, '42501');
    await b.query('commit');
    await state(f, 1, 'REVISION_REQUESTED', 'OPEN');

    // Replacement wins; a stale request cannot reject the previous preview.
    f = await fixture();
    await begin(a);
    await begin(b, 'customer_a');
    const current = (await a.query(record, f.args)).rows[0].asset.assetId;
    await attempt(b, 'Revision request waits for upload', request, [f.id, f.first], '55P03');
    await a.query('commit');
    await attempt(b, 'Stale revision request is refused', request, [f.id, f.first], '40001');
    await b.query('commit');
    await state(f, 2, 'PREVIEW_READY', 'RESOLVED', current);
    await begin(b, 'customer_a');
    await b.query(request, [f.id, current]);
    await b.query('commit');
    equal(
      'Request for new preview creates a separate open revision',
      (
        await db.query(
          'select status,preview_asset_id,resolved_by_preview_asset_id from public.project_revisions where project_id=$1 order by requested_at,id',
          [f.id],
        )
      ).rows,
      [
        { status: 'RESOLVED', preview_asset_id: f.first, resolved_by_preview_asset_id: current },
        { status: 'OPEN', preview_asset_id: current, resolved_by_preview_asset_id: null },
      ],
    );

    // Losing/aborted upload never leaks its resolution or notification.
    f = await fixture();
    await begin(a);
    await begin(b);
    await a.query(record, f.args);
    await attempt(b, 'Announcement waits for uncommitted upload', ready, [f.id], '55P03');
    await a.query('rollback');
    await attempt(b, 'Aborted replacement cannot authorize announcement', ready, [f.id], '23514');
    await b.query('commit');
    await state(f, 1, 'IN_PRODUCTION', 'OPEN');
    equal(
      'Aborted replacement creates no revised-preview notification',
      (
        await db.query(
          "select count(*)::int as n from public.notification_outbox where project_id=$1 and event_type='PREVIEW_REVISED_CUSTOMER'",
          [f.id],
        )
      ).rows[0].n,
      0,
    );
    console.log(`H5 native concurrency: ${checks} assertions passed`);
    return checks;
  } finally {
    for (const c of clients.reverse()) {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runH5Concurrency().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
