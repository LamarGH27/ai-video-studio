/**
 * Live verification against a real Supabase project.
 *
 * supabase/tests/run-local.sh proves the DATABASE half of the security model
 * (RLS policies, triggers, constraints) against a local PostgreSQL cluster.
 * It cannot prove the parts that live above Postgres:
 *
 *   * Supabase Auth — can these accounts actually sign in?
 *   * PostgREST — do the policies hold over the real HTTP API, with a real JWT?
 *   * Storage — signed upload URLs, signed read URLs, MIME and size enforcement,
 *     and whether one customer can reach another's object through the API.
 *
 * This script covers those. It makes real network calls and writes real rows.
 *
 *   POINT IT AT A NON-PRODUCTION PROJECT. It creates and deletes data.
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-live.ts
 *   npm run verify:live
 *
 * Required environment (see .env.example):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   E2E_CUSTOMER_A_EMAIL / E2E_CUSTOMER_A_PASSWORD
 *   E2E_CUSTOMER_B_EMAIL / E2E_CUSTOMER_B_PASSWORD
 *   E2E_ADMIN_EMAIL      / E2E_ADMIN_PASSWORD
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]!.replace(/^["']|["']$/g, '');
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing ${name}. See .env.example.\n`);
    process.exit(2);
  }
  return value;
}

const SUPABASE_URL = required('NEXT_PUBLIC_SUPABASE_URL');
const PUBLISHABLE_KEY = required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

const PRINCIPALS = {
  customerA: {
    email: required('E2E_CUSTOMER_A_EMAIL'),
    password: required('E2E_CUSTOMER_A_PASSWORD'),
  },
  customerB: {
    email: required('E2E_CUSTOMER_B_EMAIL'),
    password: required('E2E_CUSTOMER_B_PASSWORD'),
  },
  admin: { email: required('E2E_ADMIN_EMAIL'), password: required('E2E_ADMIN_PASSWORD') },
};

const BUCKET = 'reference-images';
const DELIVERY_BUCKET = 'project-deliveries';

// ---------------------------------------------------------------------------
// Result matrix
// ---------------------------------------------------------------------------
type Outcome = 'ALLOWED' | 'DENIED';

interface Row {
  area: string;
  attack: string;
  expected: Outcome;
  actual: string;
  pass: boolean;
}

const results: Row[] = [];

function record(area: string, attack: string, expected: Outcome, actual: string) {
  results.push({ area, attack, expected, actual, pass: actual.startsWith(expected) });
}

/** Runs a probe and classifies it. A probe returns ALLOWED/DENIED plus detail. */
async function probe(
  area: string,
  attack: string,
  expected: Outcome,
  fn: () => Promise<string>,
): Promise<void> {
  try {
    record(area, attack, expected, await fn());
  } catch (error) {
    record(area, attack, expected, `DENIED (threw: ${(error as Error).message.slice(0, 60)})`);
  }
}

/** PostgREST: an error is a denial; zero rows is also a denial. */
function fromQuery(result: { data: unknown[] | null; error: { code?: string } | null }): string {
  if (result.error) return `DENIED (${result.error.code ?? 'error'})`;
  const count = result.data?.length ?? 0;
  return count === 0 ? 'DENIED (0 rows)' : `ALLOWED (${count} row${count === 1 ? '' : 's'})`;
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------
function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(label: string, email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    console.error(
      `\nCould not sign in as ${label} (${email}): ${error?.message ?? 'no user returned'}\n` +
        'Create the three test users and confirm their email addresses first — see README.\n',
    );
    process.exit(2);
  }
  record('Auth', `${label} can sign in`, 'ALLOWED', 'ALLOWED (session established)');
  return client;
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nVerifying ${SUPABASE_URL}\n`);

  const a = await signIn('Customer A', PRINCIPALS.customerA.email, PRINCIPALS.customerA.password);
  const b = await signIn('Customer B', PRINCIPALS.customerB.email, PRINCIPALS.customerB.password);
  const admin = await signIn('Admin', PRINCIPALS.admin.email, PRINCIPALS.admin.password);
  const anon = anonClient();

  const aUser = (await a.auth.getUser()).data.user!;
  const bUser = (await b.auth.getUser()).data.user!;

  // The admin must actually hold the role, or every admin assertion below is
  // vacuous. Fail loudly rather than silently testing nothing.
  const adminProfile = await admin
    .from('profiles')
    .select('role')
    .eq('id', (await admin.auth.getUser()).data.user!.id)
    .maybeSingle();
  if (adminProfile.data?.role !== 'admin') {
    console.error(
      `\nE2E_ADMIN_EMAIL is not an admin (role = ${adminProfile.data?.role ?? 'unknown'}).\n` +
        "Promote it in the Supabase SQL editor — see README 'Make yourself an admin'.\n",
    );
    process.exit(2);
  }
  record('Auth', 'Admin account actually holds the admin role', 'ALLOWED', 'ALLOWED (role=admin)');

  // -------------------------------------------------------------------------
  // Fixtures: one draft project each, over the real API.
  // -------------------------------------------------------------------------
  const draft = async (client: SupabaseClient, userId: string, label: string) => {
    const { data, error } = await client
      .from('projects')
      .insert({ user_id: userId, status: 'DRAFT', brief: `${label} live-verification draft.` })
      .select('id, public_reference')
      .single();
    if (error || !data) {
      console.error(`\nCould not create a draft project for ${label}: ${error?.message}\n`);
      process.exit(2);
    }
    return data;
  };

  const aDraft = await draft(a, aUser.id, 'Customer A');
  const bDraft = await draft(b, bUser.id, 'Customer B');

  record(
    'Schema',
    'public_reference issued in AVS-000000 form',
    'ALLOWED',
    /^AVS-\d{6}$/.test(aDraft.public_reference)
      ? `ALLOWED (${aDraft.public_reference})`
      : `DENIED (got ${aDraft.public_reference})`,
  );

  // -------------------------------------------------------------------------
  // PostgREST: Customer A attacking Customer B
  // -------------------------------------------------------------------------
  await probe('API A→B', "SELECT B's project", 'DENIED', async () =>
    fromQuery(await a.from('projects').select('*').eq('id', bDraft.id)),
  );
  await probe('API A→B', "UPDATE B's project", 'DENIED', async () =>
    fromQuery(await a.from('projects').update({ brief: 'hijacked' }).eq('id', bDraft.id).select()),
  );
  await probe('API A→B', "DELETE B's project", 'DENIED', async () =>
    fromQuery(await a.from('projects').delete().eq('id', bDraft.id).select()),
  );
  await probe('API A→B', "SELECT B's project assets", 'DENIED', async () =>
    fromQuery(await a.from('project_assets').select('*').eq('project_id', bDraft.id)),
  );
  await probe('API A→B', "SELECT B's consents", 'DENIED', async () =>
    fromQuery(await a.from('project_consents').select('*').eq('project_id', bDraft.id)),
  );
  await probe('API A→B', "SELECT B's status history", 'DENIED', async () =>
    fromQuery(await a.from('project_status_history').select('*').eq('project_id', bDraft.id)),
  );
  await probe('API A→B', "SELECT B's profile", 'DENIED', async () =>
    fromQuery(await a.from('profiles').select('*').eq('id', bUser.id)),
  );
  await probe('API A→B', 'INSERT asset against B’s project', 'DENIED', async () =>
    fromQuery(
      await a
        .from('project_assets')
        .insert({
          project_id: bDraft.id,
          user_id: aUser.id,
          asset_type: 'REFERENCE_IMAGE',
          storage_bucket: BUCKET,
          storage_path: `${aUser.id}/${bDraft.id}/forged.jpg`,
          mime_type: 'image/jpeg',
          file_size: 100,
        })
        .select(),
    ),
  );
  await probe('API A→B', 'INSERT consent against B’s project', 'DENIED', async () =>
    fromQuery(
      await a
        .from('project_consents')
        .insert({
          project_id: bDraft.id,
          user_id: aUser.id,
          consent_type: 'PORTFOLIO_PERMISSION',
          granted: true,
          wording_version: '2026-01-01',
          granted_at: new Date().toISOString(),
        })
        .select(),
    ),
  );

  // -------------------------------------------------------------------------
  // Privilege escalation and immutability, over the real API
  // -------------------------------------------------------------------------
  await probe('API escalation', 'Grant self admin', 'DENIED', async () =>
    fromQuery(await a.from('profiles').update({ role: 'admin' }).eq('id', aUser.id).select()),
  );
  await probe(
    'API escalation',
    'Grant self admin alongside a legitimate field',
    'DENIED',
    async () =>
      fromQuery(
        await a
          .from('profiles')
          .update({ display_name: 'Customer A', role: 'admin' })
          .eq('id', aUser.id)
          .select(),
      ),
  );
  await probe('API escalation', 'INSERT a profile row with role=admin', 'DENIED', async () =>
    fromQuery(
      await a
        .from('profiles')
        .insert({ id: crypto.randomUUID(), display_name: 'Backdoor', role: 'admin' })
        .select(),
    ),
  );
  await probe('API immutability', 'Reassign own project to B', 'DENIED', async () =>
    fromQuery(await a.from('projects').update({ user_id: bUser.id }).eq('id', aDraft.id).select()),
  );
  await probe('API immutability', 'Change own public_reference', 'DENIED', async () =>
    fromQuery(
      await a
        .from('projects')
        .update({ public_reference: 'AVS-999999' })
        .eq('id', aDraft.id)
        .select(),
    ),
  );
  await probe('API audit', 'Forge a status-history row', 'DENIED', async () =>
    fromQuery(
      await a
        .from('project_status_history')
        .insert({ project_id: aDraft.id, from_status: 'DRAFT', to_status: 'COMPLETED' })
        .select(),
    ),
  );

  // -------------------------------------------------------------------------
  // Anonymous over the real API
  // -------------------------------------------------------------------------
  await probe('API anon', 'SELECT any project', 'DENIED', async () =>
    fromQuery(await anon.from('projects').select('*')),
  );
  await probe('API anon', 'SELECT any profile', 'DENIED', async () =>
    fromQuery(await anon.from('profiles').select('*')),
  );
  await probe('API anon', 'SELECT any project asset', 'DENIED', async () =>
    fromQuery(await anon.from('project_assets').select('*')),
  );
  await probe('API anon', 'READ active portfolio (public marketing)', 'ALLOWED', async () =>
    fromQuery(await anon.from('portfolio_items').select('*').eq('active', true)),
  );
  await probe('API anon', 'READ active experiences (public catalogue)', 'ALLOWED', async () =>
    fromQuery(await anon.from('video_experiences').select('*').eq('active', true)),
  );

  // -------------------------------------------------------------------------
  // STORAGE
  // -------------------------------------------------------------------------
  // A 1x1 JPEG. Small enough to inline, real enough to upload.
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
  const aObjectPath = `${aUser.id}/${aDraft.id}/${crypto.randomUUID()}.jpg`;

  // A gets a signed upload slot for their own project and uses it.
  const slot = await a.storage.from(BUCKET).createSignedUploadUrl(aObjectPath);
  record(
    'Storage A own',
    'Receives a signed upload URL for own project path',
    'ALLOWED',
    slot.error ? `DENIED (${slot.error.message})` : 'ALLOWED (token issued)',
  );

  if (slot.data) {
    const upload = await a.storage
      .from(BUCKET)
      .uploadToSignedUrl(slot.data.path, slot.data.token, jpeg, { contentType: 'image/jpeg' });
    record(
      'Storage A own',
      'Uploads a supported image through the signed URL',
      'ALLOWED',
      upload.error ? `DENIED (${upload.error.message})` : 'ALLOWED (object stored)',
    );

    const signedRead = await a.storage.from(BUCKET).createSignedUrl(aObjectPath, 60);
    record(
      'Storage A own',
      'Creates a signed read URL for own object',
      'ALLOWED',
      signedRead.error ? `DENIED (${signedRead.error.message})` : 'ALLOWED (URL issued)',
    );

    // The signed URL must actually serve the bytes…
    if (signedRead.data?.signedUrl) {
      const response = await fetch(signedRead.data.signedUrl);
      record(
        'Storage A own',
        'Signed read URL serves the image',
        'ALLOWED',
        response.ok ? `ALLOWED (HTTP ${response.status})` : `DENIED (HTTP ${response.status})`,
      );
    }

    // …and the raw object path must not, without a token.
    const rawResponse = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${aObjectPath}`,
    );
    record(
      'Storage anon',
      'Fetch the object through the PUBLIC url (bucket must be private)',
      'DENIED',
      rawResponse.ok
        ? `ALLOWED (HTTP ${rawResponse.status})`
        : `DENIED (HTTP ${rawResponse.status})`,
    );
  }

  // B attacking A's object.
  await probe('Storage B→A', 'Create a signed read URL for A’s object', 'DENIED', async () => {
    const result = await b.storage.from(BUCKET).createSignedUrl(aObjectPath, 60);
    return result.error ? `DENIED (${result.error.message.slice(0, 40)})` : 'ALLOWED (URL issued)';
  });
  await probe('Storage B→A', 'Download A’s object by raw path', 'DENIED', async () => {
    const result = await b.storage.from(BUCKET).download(aObjectPath);
    return result.error
      ? `DENIED (${result.error.message.slice(0, 40)})`
      : 'ALLOWED (bytes returned)';
  });
  await probe('Storage B→A', 'List A’s project folder', 'DENIED', async () => {
    const result = await b.storage.from(BUCKET).list(`${aUser.id}/${aDraft.id}`);
    const n = result.data?.length ?? 0;
    return result.error || n === 0 ? `DENIED (${n} entries)` : `ALLOWED (${n} entries)`;
  });
  await probe('Storage B→A', 'Overwrite A’s object', 'DENIED', async () => {
    const result = await b.storage
      .from(BUCKET)
      .upload(aObjectPath, jpeg, { contentType: 'image/jpeg', upsert: true });
    return result.error ? `DENIED (${result.error.message.slice(0, 40)})` : 'ALLOWED (overwritten)';
  });
  await probe('Storage B→A', 'Delete A’s object', 'DENIED', async () => {
    await b.storage.from(BUCKET).remove([aObjectPath]);
    // remove() reports success even when RLS filtered everything out, so the
    // only trustworthy check is whether the object is still readable by A.
    const still = await a.storage.from(BUCKET).createSignedUrl(aObjectPath, 60);
    return still.data?.signedUrl ? 'DENIED (object still present)' : 'ALLOWED (object gone)';
  });
  await probe('Storage B→A', 'Write into A’s folder', 'DENIED', async () => {
    const result = await b.storage
      .from(BUCKET)
      .upload(`${aUser.id}/${aDraft.id}/planted.jpg`, jpeg, { contentType: 'image/jpeg' });
    return result.error ? `DENIED (${result.error.message.slice(0, 40)})` : 'ALLOWED (planted)';
  });

  // Anonymous against storage.
  await probe('Storage anon', 'List the reference-images bucket', 'DENIED', async () => {
    const result = await anon.storage.from(BUCKET).list();
    const n = result.data?.length ?? 0;
    return result.error || n === 0 ? `DENIED (${n} entries)` : `ALLOWED (${n} entries)`;
  });
  await probe('Storage anon', 'Create a signed URL for a customer object', 'DENIED', async () => {
    const result = await anon.storage.from(BUCKET).createSignedUrl(aObjectPath, 60);
    return result.error ? `DENIED (${result.error.message.slice(0, 40)})` : 'ALLOWED (URL issued)';
  });

  // Upload policy enforcement at the bucket.
  await probe('Storage policy', 'Upload a disallowed MIME type (text/html)', 'DENIED', async () => {
    const result = await a.storage
      .from(BUCKET)
      .upload(`${aUser.id}/${aDraft.id}/evil.html`, Buffer.from('<script>alert(1)</script>'), {
        contentType: 'text/html',
      });
    return result.error ? `DENIED (${result.error.message.slice(0, 40)})` : 'ALLOWED (stored)';
  });
  await probe('Storage policy', 'Upload beyond the bucket size limit', 'DENIED', async () => {
    const oversize = Buffer.alloc(16 * 1024 * 1024, 0); // 16 MiB > 15 MiB ceiling
    const result = await a.storage
      .from(BUCKET)
      .upload(`${aUser.id}/${aDraft.id}/huge.jpg`, oversize, { contentType: 'image/jpeg' });
    return result.error ? `DENIED (${result.error.message.slice(0, 40)})` : 'ALLOWED (stored)';
  });

  // -------------------------------------------------------------------------
  // DELIVERY MEDIA (Milestone 2A)
  // -------------------------------------------------------------------------
  // The delivery bucket is private and its objects live under the CUSTOMER's
  // folder even though an administrator uploads them. These checks prove that
  // over the real Storage API, not just as policy predicates.

  // A tiny but structurally valid MP4 (ftyp box only). Storage stores bytes; it
  // does not need to be playable for an authorisation test.
  const mp4 = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQ==', 'base64');
  const deliveryPath = `${aUser.id}/${aDraft.id}/preview-v1-${crypto.randomUUID()}.mp4`;

  // Only an admin may write into the delivery bucket.
  await probe(
    'Delivery storage',
    'Customer uploads into the delivery bucket',
    'DENIED',
    async () => {
      const result = await a.storage
        .from(DELIVERY_BUCKET)
        .upload(deliveryPath, mp4, { contentType: 'video/mp4' });
      return result.error ? `DENIED (${result.error.message.slice(0, 40)})` : 'ALLOWED (stored)';
    },
  );

  const adminUpload = await admin.storage
    .from(DELIVERY_BUCKET)
    .upload(deliveryPath, mp4, { contentType: 'video/mp4' });
  record(
    'Delivery storage',
    'Admin uploads a delivery video into the customer folder',
    'ALLOWED',
    adminUpload.error ? `DENIED (${adminUpload.error.message.slice(0, 60)})` : 'ALLOWED (stored)',
  );

  if (!adminUpload.error) {
    // The owning customer can read their own delivery…
    await probe(
      'Delivery storage',
      'Owner signs a read URL for their own delivery',
      'ALLOWED',
      async () => {
        const result = await a.storage.from(DELIVERY_BUCKET).createSignedUrl(deliveryPath, 60);
        if (result.error || !result.data?.signedUrl) {
          return `DENIED (${result.error?.message.slice(0, 40) ?? 'no url'})`;
        }
        const response = await fetch(result.data.signedUrl);
        return response.ok
          ? `ALLOWED (HTTP ${response.status})`
          : `DENIED (HTTP ${response.status})`;
      },
    );

    // …and the download variant sets Content-Disposition.
    await probe(
      'Delivery storage',
      'Owner signs a DOWNLOAD url for their own delivery',
      'ALLOWED',
      async () => {
        const result = await a.storage
          .from(DELIVERY_BUCKET)
          .createSignedUrl(deliveryPath, 60, { download: 'film.mp4' });
        if (result.error || !result.data?.signedUrl) return 'DENIED (no url)';
        const response = await fetch(result.data.signedUrl);
        const disposition = response.headers.get('content-disposition') ?? '';
        return response.ok && /attachment/i.test(disposition)
          ? 'ALLOWED (attachment)'
          : `DENIED (HTTP ${response.status}, disposition="${disposition}")`;
      },
    );

    // Customer B must not reach it by any route.
    await probe('Delivery B→A', 'B signs a read URL for A’s delivery', 'DENIED', async () => {
      const result = await b.storage.from(DELIVERY_BUCKET).createSignedUrl(deliveryPath, 60);
      return result.error
        ? `DENIED (${result.error.message.slice(0, 40)})`
        : 'ALLOWED (URL issued)';
    });

    await probe('Delivery B→A', 'B downloads A’s delivery by raw path', 'DENIED', async () => {
      const result = await b.storage.from(DELIVERY_BUCKET).download(deliveryPath);
      return result.error ? `DENIED (${result.error.message.slice(0, 40)})` : 'ALLOWED (bytes)';
    });

    await probe('Delivery B→A', 'B lists A’s delivery folder', 'DENIED', async () => {
      const result = await b.storage.from(DELIVERY_BUCKET).list(`${aUser.id}/${aDraft.id}`);
      const n = result.data?.length ?? 0;
      return result.error || n === 0 ? `DENIED (${n} entries)` : `ALLOWED (${n} entries)`;
    });

    await probe('Delivery B→A', 'B overwrites A’s delivery', 'DENIED', async () => {
      const result = await b.storage
        .from(DELIVERY_BUCKET)
        .upload(deliveryPath, mp4, { contentType: 'video/mp4', upsert: true });
      return result.error
        ? `DENIED (${result.error.message.slice(0, 40)})`
        : 'ALLOWED (overwritten)';
    });

    // Anonymous, and the public URL that must not exist.
    await probe(
      'Delivery anon',
      'Anonymous signs a read URL for a delivery',
      'DENIED',
      async () => {
        const result = await anon.storage.from(DELIVERY_BUCKET).createSignedUrl(deliveryPath, 60);
        return result.error
          ? `DENIED (${result.error.message.slice(0, 40)})`
          : 'ALLOWED (URL issued)';
      },
    );

    const publicDelivery = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/${DELIVERY_BUCKET}/${deliveryPath}`,
    );
    record(
      'Delivery anon',
      'Fetch a delivery through the PUBLIC url (bucket must be private)',
      'DENIED',
      publicDelivery.ok
        ? `ALLOWED (HTTP ${publicDelivery.status})`
        : `DENIED (HTTP ${publicDelivery.status})`,
    );

    await admin.storage.from(DELIVERY_BUCKET).remove([deliveryPath]);
  }

  // The customer's two decisions are RPCs, and both must refuse a project that
  // is not the caller's — whatever its real status.
  // Neither RPC takes "whatever is latest" any more: the caller names the
  // preview they were shown. A well-formed id belonging to nothing is the right
  // argument for these cases — the refusal being proved is about the caller and
  // the project, and it must land before the asset is ever considered.
  const NO_SUCH_PREVIEW = '00000000-1111-4222-8333-444444444444';

  await probe('Delivery RPC', 'B approves A’s project', 'DENIED', async () => {
    const result = await b.rpc('approve_preview', {
      p_project_id: aDraft.id,
      p_preview_asset_id: NO_SUCH_PREVIEW,
    });
    return result.error ? `DENIED (${result.error.code ?? 'error'})` : 'ALLOWED';
  });

  await probe('Delivery RPC', 'B requests a revision on A’s project', 'DENIED', async () => {
    const result = await b.rpc('request_project_revision', {
      p_project_id: aDraft.id,
      p_preview_asset_id: NO_SUCH_PREVIEW,
      p_message: 'Changing somebody else project that I have no relationship with at all.',
    });
    return result.error ? `DENIED (${result.error.code ?? 'error'})` : 'ALLOWED';
  });

  // Owner, but the project is a DRAFT rather than PREVIEW_READY.
  await probe(
    'Delivery RPC',
    'Owner approves a project that is not PREVIEW_READY',
    'DENIED',
    async () => {
      const result = await a.rpc('approve_preview', {
        p_project_id: aDraft.id,
        p_preview_asset_id: NO_SUCH_PREVIEW,
      });
      return result.error ? `DENIED (${result.error.code ?? 'error'})` : 'ALLOWED';
    },
  );

  await probe('Delivery RPC', 'Customer writes a revision row directly', 'DENIED', async () =>
    fromQuery(
      await a
        .from('project_revisions')
        .insert({
          project_id: aDraft.id,
          user_id: aUser.id,
          message: 'Writing straight to the table rather than going through the function.',
        })
        .select(),
    ),
  );

  await probe('Delivery RPC', 'Customer writes an approval row directly', 'DENIED', async () =>
    fromQuery(
      await a
        .from('project_preview_approvals')
        .insert({ project_id: aDraft.id, user_id: aUser.id })
        .select(),
    ),
  );

  // ---------------------------------------------------------------------------
  // Notifications (Milestone 2B)
  // ---------------------------------------------------------------------------
  // Access only. This deliberately sends NO email: verification runs on every
  // change and on a schedule, and a security suite that mails real people each
  // time it runs is a suite people turn off. Whether Resend delivers is proved
  // once, on purpose — see docs/notifications.md.
  await probe('Notifications', 'Customer reads the notification outbox', 'DENIED', async () =>
    fromQuery(await a.from('notification_outbox').select('id, recipient_email, dedupe_key')),
  );

  await probe(
    'Notifications',
    'Customer reads notifications addressed to them',
    'DENIED',
    async () =>
      fromQuery(await a.from('notification_outbox').select('id').eq('recipient_user_id', aUser.id)),
  );

  await probe('Notifications', 'B reads A\u2019s notifications', 'DENIED', async () =>
    fromQuery(await b.from('notification_outbox').select('id').eq('recipient_user_id', aUser.id)),
  );

  await probe('Notifications', 'Anonymous reads the notification outbox', 'DENIED', async () =>
    fromQuery(await anon.from('notification_outbox').select('id')),
  );

  // The quietest attack on a notification system: take the dedupe key before
  // the workflow does, and the real notification is never created.
  await probe('Notifications', 'Customer enqueues a notification', 'DENIED', async () => {
    const result = await a.rpc('enqueue_notification', {
      p_event_type: 'FINAL_VIDEO_READY_CUSTOMER',
      p_recipient: 'CUSTOMER',
      p_project_id: aDraft.id,
      p_dedupe_key: `project:${aDraft.id}:completed:customer`,
      p_payload: {},
    } as never);
    return result.error ? `DENIED (${result.error.code ?? 'error'})` : 'ALLOWED';
  });

  await probe('Notifications', 'Customer drains the notification queue', 'DENIED', async () => {
    const result = await a.rpc('claim_notifications', { p_limit: 10, p_lease_seconds: 300 });
    return result.error ? `DENIED (${result.error.code ?? 'error'})` : 'ALLOWED';
  });

  await probe(
    'Notifications',
    'Customer suppresses a notification by marking it sent',
    'DENIED',
    async () => {
      const result = await a.rpc('mark_notification_sent', {
        p_id: aDraft.id,
        p_provider_message_id: null,
      });
      return result.error ? `DENIED (${result.error.code ?? 'error'})` : 'ALLOWED';
    },
  );

  await probe('Notifications', 'Customer requeues a notification', 'DENIED', async () => {
    const result = await a.rpc('retry_notification', { p_id: aDraft.id });
    return result.error ? `DENIED (${result.error.code ?? 'error'})` : 'ALLOWED';
  });

  await probe('Delivery RPC', 'Customer inserts a PREVIEW_VIDEO asset', 'DENIED', async () =>
    fromQuery(
      await a
        .from('project_assets')
        .insert({
          project_id: aDraft.id,
          user_id: aUser.id,
          asset_type: 'PREVIEW_VIDEO',
          storage_bucket: DELIVERY_BUCKET,
          storage_path: `${aUser.id}/${aDraft.id}/self-made.mp4`,
          mime_type: 'video/mp4',
          file_size: 1000,
        })
        .select(),
    ),
  );

  // -------------------------------------------------------------------------
  // Admin over the real API
  // -------------------------------------------------------------------------
  await probe('API admin', 'READ another customer’s project', 'ALLOWED', async () =>
    fromQuery(await admin.from('projects').select('*').eq('id', bDraft.id)),
  );
  await probe('API admin', 'Promote a customer to admin', 'DENIED', async () =>
    fromQuery(await admin.from('profiles').update({ role: 'admin' }).eq('id', bUser.id).select()),
  );
  await probe('API admin', 'Reassign a project to themselves', 'DENIED', async () =>
    fromQuery(
      await admin.from('projects').update({ user_id: bUser.id }).eq('id', aDraft.id).select(),
    ),
  );

  // -------------------------------------------------------------------------
  // Clean up what this run created
  // -------------------------------------------------------------------------
  await a.storage.from(BUCKET).remove([aObjectPath]);
  await a.from('projects').delete().eq('id', aDraft.id);
  await b.from('projects').delete().eq('id', bDraft.id);

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  const width = {
    area: Math.max(6, ...results.map((r) => r.area.length)),
    attack: Math.max(8, ...results.map((r) => r.attack.length)),
    expected: 8,
    actual: Math.max(8, ...results.map((r) => r.actual.length)),
  };
  const line = (r: Row | null) =>
    r === null
      ? `${'-'.repeat(width.area)}-+-${'-'.repeat(width.attack)}-+-${'-'.repeat(width.expected)}-+-${'-'.repeat(width.actual)}-+------`
      : `${r.area.padEnd(width.area)} | ${r.attack.padEnd(width.attack)} | ${r.expected.padEnd(width.expected)} | ${r.actual.padEnd(width.actual)} | ${r.pass ? 'PASS' : 'FAIL'}`;

  console.log(
    `\n${'Area'.padEnd(width.area)} | ${'Attack'.padEnd(width.attack)} | ${'Expected'.padEnd(width.expected)} | ${'Actual'.padEnd(width.actual)} | Result`,
  );
  console.log(line(null));
  for (const row of results) console.log(line(row));

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total\n`,
  );

  if (failed.length > 0) {
    console.error('FAILED:');
    for (const row of failed)
      console.error(`  - [${row.area}] ${row.attack}: expected ${row.expected}, got ${row.actual}`);
    process.exit(1);
  }
  console.log('All live verification checks passed.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
