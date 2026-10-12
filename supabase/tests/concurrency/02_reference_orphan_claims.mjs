/* Native PostgreSQL only. Run against the throwaway harness with PG* variables.
 * npm ci supplies the test-only pg driver. Never target a customer database.
 * lock_timeout observes a forced wait; it is not the correctness mechanism.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { Client } = pg;

async function runH2Concurrency(config) {
  const clients = [];
  let checks = 0;
  async function connect() {
    const c = new Client(config);
    await c.connect();
    clients.push(c);
    return c;
  }
  function equal(label, actual, expected) {
    assert.deepEqual(actual, expected, label);
    checks++;
    console.log(`PASS H2 ${label}`);
  }
  async function begin(c, isolation = 'read committed') {
    await c.query(`begin isolation level ${isolation}`);
    await c.query("select avs_test.become('customer_a')");
    await c.query("set local lock_timeout='700ms'");
  }
  async function outcome(c, label, sql, params, code = 'ok') {
    await c.query('savepoint probe');
    let result,
      actual = 'ok';
    try {
      result = await c.query(sql, params);
    } catch (e) {
      actual = e.code;
      await c.query('rollback to savepoint probe');
    }
    await c.query('release savepoint probe');
    equal(label, actual, code);
    return result;
  }
  const owner = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const confirm = "select public.confirm_reference_asset($1,$2,'reference.jpg') as asset";
  const claim = 'select public.claim_reference_orphans($1,array[$2]::text[]) as paths';
  const submit = 'select public.submit_project($1,true,true,false)';
  const remove = "delete from storage.objects where bucket_id='reference-images' and name=$1";
  try {
    const admin = await connect(),
      a = await connect(),
      b = await connect(),
      c = await connect();
    assert.equal(
      (await admin.query("select to_regnamespace('avs_test') is not null as ok")).rows[0].ok,
      true,
    );
    async function fixture() {
      const id = randomUUID(),
        name = `${owner}/${id}/orphan.jpg`;
      await admin.query(
        "insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ($1,$2,'DRAFT','A complete native H2 fixture brief with sufficient production detail.','VERTICAL_9_16',15)",
        [id, owner],
      );
      await admin.query(
        'insert into storage.objects(bucket_id,name,metadata,created_at) values (\'reference-images\',$1,\'{"size":100,"mimetype":"image/jpeg"}\',now()-interval \'2 hours\')',
        [name],
      );
      return [id, name];
    }
    async function state(args, assets, objects) {
      const r = (
        await admin.query(
          "select (select count(*)::int from public.project_assets where project_id=$1) as assets,(select count(*)::int from storage.objects where bucket_id='reference-images' and name=$2) as objects",
          args,
        )
      ).rows[0];
      equal('authoritative asset/object counts', r, { assets, objects });
    }

    // A: exact former ordering, including stale candidate selection.
    let args = await fixture();
    await begin(b);
    equal(
      'A cleanup initially sees no asset',
      (await b.query('select id from public.project_assets where project_id=$1', [args[0]]))
        .rowCount,
      0,
    );
    await b.query('commit');
    await begin(a);
    await a.query(confirm, args);
    await begin(b);
    await outcome(b, 'A claim waits for in-flight confirmation', claim, args, '55P03');
    await a.query('commit');
    equal(
      'A stale cleanup receives no deletion authority',
      (await b.query(claim, args)).rows[0].paths,
      [],
    );
    await b.query('commit');
    await state(args, 1, 1);

    // B: a durable claim survives the gap before the Storage HTTP operation.
    args = await fixture();
    await begin(a);
    await a.query(claim, args);
    await begin(b);
    await outcome(b, 'B confirmation waits for cleanup claim', confirm, args, '55P03');
    await a.query('commit');
    await outcome(b, 'B confirmation rejected before physical deletion', confirm, args, '23514');
    await b.query('commit');
    await state(args, 0, 1);
    await begin(a);
    equal('B claim retry returns retired path', (await a.query(claim, args)).rows[0].paths, [
      args[1],
    ]);
    await a.query(remove, [args[1]]);
    await a.query('commit');
    await begin(b);
    await outcome(b, 'B confirmation rejected after deletion', confirm, args, '23514');
    await b.query('commit');
    await state(args, 0, 0);

    // C: genuinely concurrent dispatch. Both serial orders are forced in A/B;
    // these ten runs check the invariant regardless of which request wins.
    for (let i = 0; i < 10; i++) {
      args = await fixture();
      await begin(a);
      await begin(b);
      const results = await Promise.all([
        a.query(confirm, args).then(
          async (r) => {
            await a.query('commit');
            return r.rows[0].asset;
          },
          async (e) => {
            await a.query('rollback');
            return e.code;
          },
        ),
        b.query(claim, args).then(async (r) => {
          await b.query('commit');
          return r.rows[0].paths;
        }),
      ]);
      const claimed = results[1].length === 1;
      equal(
        `C${i} mutually exclusive outcome`,
        claimed ? results[0] : typeof results[0],
        claimed ? '23514' : 'object',
      );
      if (claimed) {
        await begin(b);
        await b.query(remove, [args[1]]);
        await b.query('commit');
      }
      await state(args, claimed ? 0 : 1, claimed ? 0 : 1);
    }

    // D: duplicate confirmation and cleanup both wait for the winning confirm.
    args = await fixture();
    await begin(a);
    const first = (await a.query(confirm, args)).rows[0].asset;
    await begin(b);
    await begin(c);
    await outcome(b, 'D duplicate confirmation waits', confirm, args, '55P03');
    await outcome(c, 'D cleanup waits', claim, args, '55P03');
    await a.query('commit');
    equal(
      'D duplicate returns same asset',
      (await b.query(confirm, args)).rows[0].asset.id,
      first.id,
    );
    await b.query('commit');
    equal('D cleanup cannot claim confirmed asset', (await c.query(claim, args)).rows[0].paths, []);
    await c.query('commit');
    await state(args, 1, 1);

    // E: submission must wait, then either reject missing evidence or submit
    // with the committed confirmed asset. H3 still governs final deletion.
    args = await fixture();
    await begin(a);
    await a.query(claim, args);
    await begin(b);
    await outcome(b, 'E submission waits for claim', submit, [args[0]], '55P03');
    await a.query('commit');
    await outcome(b, 'E claimed orphan is not submission evidence', submit, [args[0]], '23514');
    await b.query('commit');
    equal(
      'E failed submission leaves no consent',
      (
        await admin.query(
          'select count(*)::int as n from public.project_consents where project_id=$1',
          [args[0]],
        )
      ).rows[0].n,
      0,
    );
    args = await fixture();
    await begin(a);
    await a.query(confirm, args);
    await begin(b);
    await begin(c);
    await outcome(b, 'E submission waits for confirmation', submit, [args[0]], '55P03');
    await outcome(c, 'E cleanup also waits for confirmation', claim, args, '55P03');
    await a.query('commit');
    await b.query(submit, [args[0]]);
    await b.query('commit');
    equal('E submitted cleanup returns no paths', (await c.query(claim, args)).rows[0].paths, []);
    equal(
      'E submitted direct deletion is blocked by H3',
      (await c.query(remove, [args[1]])).rowCount,
      0,
    );
    await c.query('commit');
    await state(args, 1, 1);

    // A request cancelled before claim commit must not retire the path.
    args = await fixture();
    await begin(a);
    await a.query(claim, args);
    await begin(b);
    await outcome(b, 'rollback confirmation waits for tentative claim', confirm, args, '55P03');
    await a.query('rollback');
    await b.query(confirm, args);
    await b.query('commit');
    await state(args, 1, 1);

    // The Storage write uses a separate connection. It must not replace a
    // retired path while a delayed DELETE still has authority over that name.
    args = await fixture();
    await begin(a);
    await a.query(claim, args);
    await begin(b);
    const overwrite =
      'update storage.objects set metadata=\'{"size":101,"mimetype":"image/jpeg"}\' where bucket_id=\'reference-images\' and name=$1';
    await outcome(b, 'replacement waits for cleanup claim', overwrite, [args[1]], '55P03');
    await a.query('commit');
    await outcome(b, 'replacement rejected after claim commit', overwrite, [args[1]], '42501');
    await b.query('commit');
    await state(args, 0, 1);

    // Submission can legitimately win after a claim for an unrelated orphan.
    // H3 may leave the orphan bytes behind; the valid submitted asset survives.
    args = await fixture();
    const validPath = args[1].replace('orphan.jpg', 'valid.jpg');
    await admin.query(
      'insert into storage.objects(bucket_id,name,metadata) values (\'reference-images\',$1,\'{"size":100,"mimetype":"image/jpeg"}\')',
      [validPath],
    );
    await begin(a);
    await a.query(confirm, [args[0], validPath]);
    await a.query('commit');
    await begin(a);
    await a.query(claim, args);
    await a.query('commit');
    await begin(b);
    await b.query(submit, [args[0]]);
    await b.query('commit');
    await begin(a);
    equal(
      'submitted orphan deletion remains blocked by H3',
      (await a.query(remove, [args[1]])).rowCount,
      0,
    );
    await a.query('commit');
    await state([args[0], validPath], 1, 1);

    // A stale transaction snapshot must not circumvent the locking protocol.
    args = await fixture();
    for (const isolation of ['repeatable read', 'serializable']) {
      await begin(a, isolation);
      await outcome(a, `${isolation} claim fails closed`, claim, args, '25001');
      await outcome(a, `${isolation} new confirmation fails closed`, confirm, args, '25001');
      await outcome(a, `${isolation} replacement fails closed`, overwrite, [args[1]], '25001');
      await a.query('rollback');
    }
    console.log(`H2 native concurrency: ${checks} assertions passed`);
    return checks;
  } finally {
    for (const c of clients.reverse()) {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  }
}
export { runH2Concurrency };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runH2Concurrency().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
