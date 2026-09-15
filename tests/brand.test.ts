import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyrightLine } from '@/lib/brand';
import { prose, readSource as read } from './support/source';

const ROOT = process.cwd();

/**
 * The old working name, as it would appear to a customer. Written in pieces so
 * this file can assert the string's absence without containing it: a test that
 * greps for text it also contains is a test that can only fail.
 */
const OLD_NAME = ['AI', 'Video', 'Studio'].join(' ');

/**
 * Surfaces a customer actually reads. Every one of these renders the name from
 * lib/brand, so this list is really asserting that none of them went back to a
 * literal.
 */
const CUSTOMER_FACING = [
  'app/layout.tsx',
  'components/site/wordmark.tsx',
  'components/site/site-header.tsx',
  'components/site/site-footer.tsx',
  'components/site/mobile-nav.tsx',
  'app/(auth)/layout.tsx',
  'app/(marketing)/page.tsx',
  'app/(marketing)/how-it-works/page.tsx',
  'app/(marketing)/portfolio/page.tsx',
  'app/(marketing)/pricing/page.tsx',
  'app/(app)/create/page.tsx',
  'app/(app)/dashboard/page.tsx',
  'app/(app)/dashboard/projects/[id]/page.tsx',
  'app/(app)/admin/page.tsx',
  'app/(app)/admin/projects/[id]/page.tsx',
  'app/(app)/admin/notifications/page.tsx',
  'lib/consent/definitions.ts',
  'lib/notifications/templates/layout.ts',
  'lib/notifications/templates/index.ts',
] as const;

describe('the public brand', () => {
  it('is Scenelio by default', async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_BRAND_NAME;
    const { brand } = await import('@/lib/brand');
    expect(brand.name).toBe('Scenelio');
    expect(brand.summary).toBe('Scenelio — personalised cinematic films from your photos');
  });

  it('keeps the approved proposition, which is not the brand name', async () => {
    // The rename must not have quietly become a repositioning.
    const { brand } = await import('@/lib/brand');
    expect(brand.tagline).toBe('Your photos. Your vision. Your movie.');
    expect(brand.descriptor).toBe('Cinematic films made from your photographs');
  });

  it('does not describe itself as a generator or a tool', async () => {
    const { brand } = await import('@/lib/brand');
    const copy = [brand.tagline, brand.proposition, brand.descriptor, brand.summary].join(' ');
    for (const phrasing of [
      /AI generator/i,
      /generate ai videos/i,
      /ai video tool/i,
      /instantly/i,
    ]) {
      expect(copy, 'positioning slipped toward a generic AI tool').not.toMatch(phrasing);
    }
  });

  it('puts the trading name in the copyright line, and no company suffix', () => {
    expect(copyrightLine(2026)).toBe('© 2026 Scenelio');
    expect(copyrightLine(2026)).not.toMatch(/\b(Ltd|Limited|Inc|LLC|PLC|LLP|GmbH)\b/);
  });

  /**
   * Scenelio is a trading brand. No entity of that name is registered, so the
   * code must not carry one — and must not carry a field whose name implies
   * one is configured, which is how a trading name ends up on a terms page.
   */
  it('claims no legal entity, because none exists', async () => {
    const { brand } = await import('@/lib/brand');
    expect(brand.legalEntity, 'an entity was configured without being registered').toBeNull();
    expect(brand, 'legalName invites a trading name into a legal surface').not.toHaveProperty(
      'legalName',
    );
  });

  /**
   * Checks the object's values, not the file's text. An earlier version of this
   * regexed single-quoted spans out of the source, which silently stopped
   * working the moment a doc comment contained an apostrophe — the quote
   * pairing desynchronises and it scans the wrong ranges. Reading the values is
   * both exact and immune to how the file is written.
   */
  it('never presents the brand as an incorporated company', async () => {
    const { brand } = await import('@/lib/brand');

    const strings = (value: unknown): string[] => {
      if (typeof value === 'string') return [value];
      if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
      return [];
    };

    const values = strings(brand);
    expect(values.length).toBeGreaterThan(4);
    for (const value of values) {
      expect(value, `"${value}" implies an incorporated entity`).not.toMatch(
        /\b(Ltd|Limited|Inc|LLC|PLC|LLP|GmbH)\b/,
      );
    }
  });
});

describe('the brand override', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_BRAND_NAME;
    vi.resetModules();
  });

  it('still lets a preview deployment carry another name', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_BRAND_NAME = 'Preview Brand';
    const { brand, copyrightLine: line } = await import('@/lib/brand');
    expect(brand.name).toBe('Preview Brand');
    expect(brand.summary).toBe('Preview Brand — personalised cinematic films from your photos');
    // The override is a rename, not a repositioning.
    expect(brand.tagline).toBe('Your photos. Your vision. Your movie.');
    expect(line(2026)).toContain('2026');
  });

  it('ignores an override that is only whitespace', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_BRAND_NAME = '   ';
    const { brand } = await import('@/lib/brand');
    expect(brand.name).toBe('Scenelio');
  });
});

/**
 * The rename is only safe because the name was never scattered. These assert
 * the surfaces still read it from one place rather than having drifted back to
 * a hard-coded string — which is the failure mode that makes the NEXT rename
 * expensive, whether or not this one was clean.
 */
describe('nothing hard-codes the name', () => {
  it('leaves no trace of the old name on a customer-facing surface', () => {
    for (const path of CUSTOMER_FACING) {
      expect(read(path), `${path} still says the old name`).not.toContain(OLD_NAME);
    }
  });

  /**
   * One deliberate exception, and it is the interesting one.
   *
   * lib/consent/definitions.ts SHOULD hard-code the name. Its statements are
   * versioned legal text: only the version is stored on a consent record, so
   * the words have to be a literal pinned to that version. If the statement
   * read `brand.name`, a NEXT_PUBLIC_BRAND_NAME override — or the next rename —
   * would silently change what an already-signed consent resolves to, which is
   * the exact failure the versioning exists to prevent.
   */
  it('does not hard-code the new one either', () => {
    const CONSENT = 'lib/consent/definitions.ts';
    for (const path of CUSTOMER_FACING) {
      if (path === CONSENT) continue;
      // Comments may name it; rendered strings may not.
      expect(prose(path), `${path} hard-codes the brand instead of reading it`).not.toMatch(
        /Scenelio/,
      );
    }

    // And the exception is genuinely pinned rather than merely stale.
    const consent = read(CONSENT);
    expect(consent).toContain('displayed publicly in the Scenelio portfolio.');
    expect(consent, 'a consent statement must never interpolate a runtime value').not.toMatch(
      /statement:[^;]*\$\{/,
    );
  });

  it('bumped the consent version, because only the version is stored', async () => {
    const { CONSENT_WORDING_VERSION } = await import('@/lib/consent/definitions');
    expect(CONSENT_WORDING_VERSION).not.toBe('2026-01-01');
    // The superseded text is recorded, so an old record still resolves.
    const history = read('docs/architecture.md');
    expect(history).toContain(CONSENT_WORDING_VERSION);
    expect(history).toContain('`2026-01-01` | superseded');
    expect(history).toContain(`in the ${OLD_NAME.split(' ')[0]}`);
  });

  it('reads the name from lib/brand wherever a surface shows it', () => {
    for (const path of ['components/site/wordmark.tsx', 'components/site/site-footer.tsx']) {
      expect(read(path)).toMatch(/from '@\/lib\/brand'/);
      expect(read(path)).toMatch(/brand\.name|copyrightLine/);
    }
    // Emails too: a message that disagrees with the website is worse than one
    // with no name in it at all.
    expect(read('lib/notifications/templates/layout.ts')).toMatch(/const BRAND = brand\.name;/);
  });
});

describe('metadata', () => {
  const layout = read('app/layout.tsx');

  it('titles the site with the brand and the tagline', () => {
    expect(layout).toMatch(/default: `\$\{brand\.name\} — \$\{brand\.tagline\}`/);
    expect(layout).toMatch(/template: `%s · \$\{brand\.name\}`/);
  });

  it('names the brand for the machines that read it', () => {
    expect(layout).toMatch(/applicationName: brand\.name/);
    expect(layout).toMatch(/siteName: brand\.name/);
    expect(layout).toMatch(/twitter: \{/);
  });

  /**
   * metadataBase must stay a runtime lookup. Writing scenelio.co.uk here would
   * make every preview deployment advertise canonical URLs pointing at
   * production, which is the quiet way to lose preview crawling and break
   * shared preview links.
   */
  it('resolves its own origin instead of hard-coding production', () => {
    expect(layout).toMatch(/metadataBase: new URL\(siteUrl\(\)\)/);
    expect(prose('app/layout.tsx')).not.toMatch(/scenelio\.co\.uk/);
    expect(prose('lib/env.ts')).not.toMatch(/scenelio\.co\.uk/);
  });
});

/**
 * Public branding and infrastructure naming are separate concerns, and this
 * milestone deliberately renamed only one of them. These assert the other one
 * did NOT move: a cosmetic rename of a deployed Supabase object or an applied
 * migration is real risk bought for nothing.
 */
describe('infrastructure keeps its own names', () => {
  it('leaves the applied migrations untouched', () => {
    const initial = readFileSync(
      join(ROOT, 'supabase/migrations/20260101000000_initial_schema.sql'),
      'utf8',
    );
    // Header comment and reference prefix both still carry the original name.
    expect(initial).toContain(`-- ${OLD_NAME} — initial schema`);
    expect(initial).toContain("select 'AVS-' ||");
  });

  it('keeps the AVS- project reference customers already quote', () => {
    expect(read('scripts/verify-live.ts')).toMatch(/\^AVS-/);
  });

  it('keeps the package and repository identifier', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('ai-video-studio');
  });
});
