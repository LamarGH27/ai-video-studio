import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pathToFileURL } from 'node:url';

// Also runs against explicitly selected staging. Lock unrelated queue rows so
// SKIP LOCKED leaves them untouched. No provider calls or real emails occur.
export async function runH6Concurrency(config, { adminId } = {}) {
  const clients = [],
    ids = [];
  let checks = 0;
  async function connect(worker = false) {
    const c = new pg.Client(config);
    await c.connect();
    clients.push(c);
    await c.query("set statement_timeout='10s'");
    if (worker) await c.query('set role service_role');
    return c;
  }
  function equal(label, actual, expected) {
    assert.deepEqual(actual, expected, label);
    checks++;
    console.log(`PASS H6 ${label}`);
  }
  let db, guard;
  try {
    db = await connect();
    guard = await connect();
    if (!adminId)
      assert.equal(
        (await db.query("select to_regnamespace('avs_test') is not null as ok")).rows[0].ok,
        true,
      );
    await guard.query('begin');
    await guard.query('select id from public.notification_outbox for update');
    const a = await connect(true),
      b = await connect(true),
      operator = await connect();
    async function fixture(attempt = 0) {
      const id = randomUUID();
      ids.push(id);
      await db.query(
        `insert into public.notification_outbox(id,event_type,recipient,payload,dedupe_key,attempt_count)
        values($1,'PROJECT_SUBMITTED_ADMIN','ADMIN','{}',$2,$3)`,
        [id, `h6-verification:${id}`, attempt],
      );
      return id;
    }
    const claim = async (c) =>
      (await c.query('select * from public.claim_notifications(1,30)')).rows;
    const sent = async (c, r) =>
      (
        await c.query('select public.mark_notification_sent($1,$2,$3) as ok', [
          r.id,
          r.claim_token,
          'h6-test-message',
        ])
      ).rows[0].ok;
    const fail = async (c, r, permanent = false) =>
      (
        await c.query('select public.mark_notification_failed($1,$2,$3,$4) as ok', [
          r.id,
          r.claim_token,
          'H6 fixture provider failure',
          permanent,
        ])
      ).rows[0].ok;
    const expire = async (id) =>
      db.query(
        "update public.notification_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1",
        [id],
      );
    const state = async (id) =>
      (await db.query('select * from public.notification_outbox where id=$1', [id])).rows[0];
    async function retry(id) {
      await operator.query('begin');
      if (adminId) {
        await operator.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: adminId, role: 'authenticated' }),
        ]);
        await operator.query('set local role authenticated');
      } else await operator.query("select avs_test.become('admin')");
      const ok = (await operator.query('select public.retry_notification($1) as ok', [id])).rows[0]
        .ok;
      await operator.query('commit');
      return ok;
    }
    let id = await fixture();
    // Actual simultaneous calls, not sequential claims dressed up as concurrency.
    let both = await Promise.all([claim(a), claim(b)]);
    equal(
      'simultaneous workers claim a single row only once',
      both.map((x) => x.length).sort(),
      [0, 1],
    );
    let first = both.flat()[0];
    equal('new claim has identity', typeof first.claim_token, 'string');
    equal('active lease cannot be manually retried', await retry(id), false);
    equal('normal sent acknowledgement', await sent(a, first), true);
    equal('duplicate acknowledgement rejected', await sent(b, first), false);
    equal('sent row cannot be retried', await retry(id), false);
    equal('sent row cannot be claimed again', (await claim(a)).length, 0);

    id = await fixture();
    first = (await claim(a))[0];
    await expire(id);
    equal('expired worker cannot acknowledge before reclaim', await sent(a, first), false);
    const replacement = (await claim(b))[0];
    equal('reclaim rotates token', replacement.claim_token !== first.claim_token, true);
    equal('reclaim increments attempt', replacement.attempt_count, 2);
    equal('stale failure cannot overwrite new lease', await fail(a, first, true), false);
    equal('stale success cannot overwrite new lease', await sent(a, first), false);
    equal('replacement can acknowledge', await sent(b, replacement), true);

    id = await fixture(4);
    first = (await claim(a))[0];
    equal('final attempt is claimed', first.attempt_count, 5);
    await expire(id);
    both = await Promise.all([claim(a), claim(b)]);
    equal('final expired claim is not sent a sixth time', both.flat().length, 0);
    let current = await state(id);
    equal(
      'expired final claim is visible as dead letter',
      [current.status, current.next_attempt_at, current.claim_token],
      ['FAILED', null, null],
    );
    equal(
      'dead letter explains ambiguous outcome',
      current.last_error.includes('outcome unknown'),
      true,
    );
    equal('dead letter rejects stale acknowledgement', await sent(a, first), false);
    equal('operator can retry expired final claim', await retry(id), true);
    current = await state(id);
    equal(
      'manual retry preserves identity and event key',
      [current.id, current.dedupe_key, current.attempt_count],
      [id, first.dedupe_key, 0],
    );
    const retried = (await claim(a))[0];
    equal('retry has a fresh claim token', retried.claim_token !== first.claim_token, true);
    equal('permanent provider failure acknowledged', await fail(a, retried, true), true);
    equal('permanent failure is stopped', (await state(id)).next_attempt_at, null);

    id = await fixture();
    first = (await claim(a))[0];
    equal('transient provider failure acknowledged', await fail(a, first), true);
    current = await state(id);
    equal(
      'transient failure scheduled',
      [current.status, current.next_attempt_at > Date.now(), current.claim_token],
      ['FAILED', true, null],
    );
    equal('not reclaimed before backoff', (await claim(b)).length, 0);
    await expire(id);
    first = (await claim(a))[0];
    // Hold the row in one transaction: SKIP LOCKED and stale UPDATE contend
    // through real independent sessions while a reclaim is uncommitted.
    await expire(id);
    await a.query('begin');
    const held = (await claim(a))[0];
    equal('competing claimant skips locked row', (await claim(b)).length, 0);
    await b.query('begin');
    await b.query("set local lock_timeout='200ms'");
    let code;
    try {
      await sent(b, first);
      code = 'unexpected success';
    } catch (e) {
      code = e.code;
    }
    equal('acknowledgement waits for reclaim row lock', code, '55P03');
    await b.query('rollback');
    await a.query('commit');
    equal('old worker remains fenced after reclaim commits', await sent(b, first), false);
    const acknowledgements = await Promise.all([sent(a, held), fail(b, held, true)]);
    equal(
      'concurrent success/failure acknowledgements have one winner',
      acknowledgements.filter(Boolean).length,
      1,
    );
    current = await state(id);
    equal(
      'winner leaves terminal consistent state',
      ['SENT', 'FAILED'].includes(current.status) &&
        current.claim_token === null &&
        current.next_attempt_at === null,
      true,
    );
    console.log(`H6 CONCURRENCY: ${checks} passed`);
    return checks;
  } finally {
    // Roll back any unfinished transactions before fixture cleanup.
    for (const c of clients) {
      try {
        await c.query('rollback');
      } catch {}
    }
    if (db && ids.length)
      await db.query('delete from public.notification_outbox where id=any($1::uuid[])', [ids]);
    await Promise.all(clients.map((c) => c.end()));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runH6Concurrency({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    database: process.env.PGDATABASE ?? 'postgres',
    password: process.env.PGPASSWORD,
  });
}
