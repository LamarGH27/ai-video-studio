import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Configuration safety, asserted against the repository itself.
 *
 * This milestone introduces four server-only secrets, one of which
 * (SUPABASE_SECRET_KEY) bypasses Row Level Security. Every other Supabase
 * client in this application acts as a signed-in user; that one does not,
 * because a scheduled queue runner has no user to act as.
 *
 * The mistake that would matter is not using it — it is using it somewhere
 * else, or letting its name acquire a NEXT_PUBLIC_ prefix, which inlines the
 * value into the browser bundle where anyone can read it. Neither is something
 * a reviewer reliably notices, so both are mechanical assertions.
 */

const ROOT = process.cwd();

const SERVER_ONLY_VARIABLES = [
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'ADMIN_NOTIFICATION_EMAIL',
  'CRON_SECRET',
  'SUPABASE_SECRET_KEY',
] as const;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'test-results', 'playwright-report'].includes(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (/\.(ts|tsx|mts|js|jsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const FILES = sourceFiles(ROOT).map((path) => ({
  path: relative(ROOT, path),
  source: readFileSync(path, 'utf8'),
}));

describe('the server-only variables stay server-only', () => {
  it('never appears with a NEXT_PUBLIC_ prefix anywhere', () => {
    for (const variable of SERVER_ONLY_VARIABLES) {
      for (const file of FILES) {
        expect(
          file.source.includes(`NEXT_PUBLIC_${variable}`),
          `${file.path} exposes ${variable} to the browser`,
        ).toBe(false);
      }
    }
  });

  it('is read by application code only through lib/notifications/config.ts', () => {
    // One reader means one place to audit, and one place to change if these
    // ever move to a secrets manager. Tests are exempt: exercising the worker
    // under a given configuration means setting that configuration, and a test
    // cannot leak anything to a browser.
    for (const variable of SERVER_ONLY_VARIABLES) {
      const readers = FILES.filter(
        (file) =>
          file.source.includes(`process.env.${variable}`) &&
          file.path !== 'lib/notifications/config.ts' &&
          !file.path.startsWith('tests/'),
      );
      expect(
        readers.map((file) => file.path),
        `${variable} is read outside config.ts`,
      ).toEqual([]);
    }
  });

  it('keeps .env.example to names and placeholders, with no values', () => {
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
    for (const variable of SERVER_ONLY_VARIABLES) {
      expect(example, `.env.example does not document ${variable}`).toContain(`${variable}=`);
      // A documented variable with a value in it is a committed secret.
      const line = example.split('\n').find((l) => l.startsWith(`${variable}=`));
      expect(line, `${variable} has a committed value`).toBe(`${variable}=`);
    }
  });
});

describe('the RLS-bypassing client is contained', () => {
  const WORKER_CLIENT = 'lib/supabase/worker.ts';

  it('is imported by the processor alone', () => {
    const importers = FILES.filter(
      (file) =>
        file.path !== WORKER_CLIENT && /from ['"]@\/lib\/supabase\/worker['"]/.test(file.source),
    ).map((file) => file.path);

    // If this list grows, the blast radius of the key grows with it, and the
    // growth must be a deliberate decision rather than a diff nobody read.
    expect(importers).toEqual(['lib/notifications/processor.ts']);
  });

  it('is marked server-only, so importing it from a component is a build error', () => {
    const source = readFileSync(join(ROOT, WORKER_CLIENT), 'utf8');
    expect(source).toContain("import 'server-only'");
    expect(readFileSync(join(ROOT, 'lib/notifications/config.ts'), 'utf8')).toContain(
      "import 'server-only'",
    );
  });

  it('refuses to fall back to the publishable key', () => {
    // A fallback would be worse than failing: the publishable client sees an
    // empty outbox under RLS, so the worker would report a healthy empty queue
    // forever while nothing was ever sent.
    const source = readFileSync(join(ROOT, WORKER_CLIENT), 'utf8');
    expect(source).toMatch(/throw new Error/);
    expect(source).not.toContain('publishableKey');
  });

  it('is reached only behind the cron secret', () => {
    const route = readFileSync(
      join(ROOT, 'app/api/internal/notifications/process/route.ts'),
      'utf8',
    );
    // Authorisation is checked before any processing is started.
    const authIndex = route.indexOf('isAuthorised(request)');
    const processIndex = route.indexOf('processNotifications(');
    expect(authIndex).toBeGreaterThan(-1);
    expect(processIndex).toBeGreaterThan(authIndex);
    // Constant time, because a byte-by-byte comparison leaks the secret.
    expect(route).toContain('timingSafeEqual');
  });

  it('treats a missing cron secret as closed, not open', () => {
    const route = readFileSync(
      join(ROOT, 'app/api/internal/notifications/process/route.ts'),
      'utf8',
    );
    expect(route).toMatch(/if \(!configured\) return false/);
  });

  it('accepts no instruction about what to send', () => {
    const route = readFileSync(
      join(ROOT, 'app/api/internal/notifications/process/route.ts'),
      'utf8',
    );
    // The endpoint runs the queue. It must not read a recipient, a project or
    // an event from the request, or it becomes a way to make us send mail.
    expect(route).not.toMatch(/request\.json\(\)/);
    expect(route).not.toMatch(/searchParams/);
  });
});

describe('the outbox schema keeps secrets and media out', () => {
  const migration = readFileSync(
    join(ROOT, 'supabase/migrations/20260101000700_notification_outbox.sql'),
    'utf8',
  );

  it('refuses to store anything URL-shaped in a payload', () => {
    expect(migration).toContain('notification_outbox_payload_has_no_urls');
    expect(migration).toMatch(/storage\/v1|https\?:\/\//);
  });

  it('has no insert, update or delete policy for any role', () => {
    const policies = [...migration.matchAll(/create policy "([^"]+)"[\s\S]*?for (\w+)/g)].map(
      (match) => ({ name: match[1]!, command: match[2]! }),
    );
    const outboxPolicies = policies.filter((policy) =>
      policy.name.startsWith('notification_outbox'),
    );
    expect(outboxPolicies.length).toBeGreaterThan(0);
    for (const policy of outboxPolicies) {
      expect(policy.command, `${policy.name} is not read-only`).toBe('select');
    }
  });
});
