import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cronSecret } from '@/lib/notifications/config';
import { processNotifications } from '@/lib/notifications/processor';

/**
 * The queue runner's endpoint. Invoked by Vercel Cron, and by an operator with
 * curl when they want to drain the queue now.
 *
 * It runs THE QUEUE. It takes no parameters describing what to send, no
 * recipient, no project and no event — so a caller who somehow obtained the
 * secret still cannot ask for a particular customer's notification, or cause an
 * email that no workflow event produced. The only thing it can do is what would
 * have happened five minutes later anyway.
 *
 * Authorisation is CRON_SECRET, compared in constant time. Vercel Cron sends it
 * as `Authorization: Bearer <CRON_SECRET>`; an operator can send the same
 * header. Anything else gets 401 with no detail — not whether the secret is
 * configured, not how close the attempt was.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A batch of twenty round trips to an email provider needs more than the
// default serverless slice, and less than a minute.
export const maxDuration = 60;

function isAuthorised(request: Request): boolean {
  const configured = cronSecret();

  // Unconfigured means closed, not open. A deployment that forgot the secret
  // must not expose a public queue runner.
  if (!configured) return false;

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(configured, 'utf8');

  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length. Compare a fixed-size digest-like pair instead: pad to equal length
  // and require the lengths to match as a separate boolean, folded in at the end
  // so both branches cost the same.
  const sameLength = a.length === b.length;
  const left = sameLength ? a : b;
  const equal = timingSafeEqual(left, b);

  return sameLength && equal;
}

async function run(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    const result = await processNotifications();
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    // The message is for our own logs and for the operator holding the secret.
    // It never reaches a customer, and it never contains a credential: the
    // configuration errors thrown upstream name the variable, not its value.
    const message = error instanceof Error ? error.message : 'Notification processing failed';
    console.error('[notifications] processing failed:', message);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}

// Vercel Cron issues GET. POST is accepted for manual runs and for schedulers
// that prefer it.
export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
