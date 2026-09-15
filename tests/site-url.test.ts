import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prose, readSource as read } from './support/source';

const ROOT = process.cwd();

/**
 * The production hostname, assembled rather than written, so this file can
 * assert its absence from the source tree without being a hit itself.
 */
const PROD_HOST = ['scenelio', 'co', 'uk'].join('.');

const ENV_KEYS = ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_VERCEL_URL', 'VERCEL_URL'] as const;

async function loadSiteUrl(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  vi.resetModules();
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  const { siteUrl } = await import('@/lib/env');
  return siteUrl();
}

describe('the canonical origin', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.resetModules();
  });

  it('is whatever NEXT_PUBLIC_SITE_URL says', async () => {
    await expect(loadSiteUrl({ NEXT_PUBLIC_SITE_URL: `https://${PROD_HOST}` })).resolves.toBe(
      `https://${PROD_HOST}`,
    );
  });

  /**
   * Every consumer concatenates a path onto this. One trailing slash here is a
   * double slash in every auth redirect and every link in every email.
   */
  it('never ends in a slash, however it is configured', async () => {
    await expect(loadSiteUrl({ NEXT_PUBLIC_SITE_URL: `https://${PROD_HOST}/` })).resolves.toBe(
      `https://${PROD_HOST}`,
    );
  });

  it('beats the Vercel-injected origin when both are present', async () => {
    await expect(
      loadSiteUrl({
        NEXT_PUBLIC_SITE_URL: `https://${PROD_HOST}`,
        NEXT_PUBLIC_VERCEL_URL: 'my-branch-abc123.vercel.app',
      }),
    ).resolves.toBe(`https://${PROD_HOST}`);
  });

  /**
   * A preview must resolve to ITSELF. If it fell back to production, its auth
   * redirects would land on the live site and its canonical tags would claim to
   * be production — which is the specific way a preview poisons an index.
   */
  it('falls back to the preview origin so a preview is self-consistent', async () => {
    await expect(loadSiteUrl({ NEXT_PUBLIC_VERCEL_URL: 'preview-abc.vercel.app' })).resolves.toBe(
      'https://preview-abc.vercel.app',
    );
    await expect(loadSiteUrl({ VERCEL_URL: 'preview-def.vercel.app' })).resolves.toBe(
      'https://preview-def.vercel.app',
    );
  });

  it('falls back to localhost so development needs no configuration', async () => {
    await expect(loadSiteUrl({})).resolves.toBe('http://localhost:3000');
  });
});

/**
 * The production hostname belongs in an environment variable, not in the
 * source. Written in one place it is a deployment decision; written in twenty
 * it is a migration.
 */
describe('no hardcoded production hostname', () => {
  const SOURCE_DIRS = ['app', 'lib', 'features', 'components'] as const;

  function sourceFiles(dir: string): string[] {
    const absolute = join(ROOT, dir);
    const out: string[] = [];
    for (const entry of readdirSync(absolute)) {
      const full = join(absolute, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(relative(ROOT, full)));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, full));
    }
    return out;
  }

  it('keeps it out of every application file', () => {
    const files = SOURCE_DIRS.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(40);

    for (const file of files) {
      // Comments may name the domain; code may not.
      expect(prose(file), `${file} hardcodes the production hostname`).not.toContain(PROD_HOST);
    }
  });

  it('keeps it out of the middleware and the build config', () => {
    for (const file of ['proxy.ts', 'next.config.ts']) {
      expect(prose(file), `${file} hardcodes the production hostname`).not.toContain(PROD_HOST);
    }
  });

  /**
   * www -> apex is Vercel's job. An application-level host redirect would run
   * on every request, duplicate a rule that already exists at the edge, and be
   * the thing nobody remembers when the domain changes.
   */
  it('implements no application-level host redirect', () => {
    const middleware = prose('proxy.ts');
    expect(middleware).not.toMatch(/\bwww\./);
    expect(middleware).not.toMatch(/get\(['"]host['"]\)|x-forwarded-host/i);
    expect(read('next.config.ts')).not.toMatch(/async redirects/);
  });
});

describe('absolute URLs are built from one origin', () => {
  it('metadata resolves its own origin and canonicalises relatively', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toMatch(/metadataBase: new URL\(siteUrl\(\)\)/);
    // Relative, so it resolves against metadataBase per route rather than
    // pinning a host that would be wrong on every preview.
    expect(layout).toMatch(/alternates: \{ canonical: '\.\/' \}/);
    expect(layout).toMatch(/url: '\.\/'/);
  });

  it('auth redirects are built from siteUrl, not from a literal', () => {
    const actions = read('features/auth/actions.ts');
    const redirects = actions.match(/(emailRedirectTo|redirectTo):\s*`[^`]+`/g) ?? [];
    expect(redirects.length).toBeGreaterThanOrEqual(2);
    for (const redirect of redirects) {
      expect(redirect, 'an auth redirect does not use siteUrl()').toContain('${siteUrl()}');
    }
  });

  it('email deep links take the origin as context rather than importing it', () => {
    const templates = read('lib/notifications/templates/index.ts');
    // The renderer is pure: the worker passes the origin in, which is what
    // makes the templates testable against an arbitrary host.
    expect(templates).toMatch(/context\.siteUrl\.replace\(\/\\\/\$\/, ''\)/);
    expect(read('lib/notifications/processor.ts')).toMatch(/siteUrl: siteUrl\(\)/);
  });
});
