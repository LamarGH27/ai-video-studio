import { describe, expect, it } from 'vitest';
import { prose, readSource as read, stripComments } from './support/source';
import { JOURNEY_BRIEF_STEPS, JOURNEY_PRODUCTION_STAGES } from '@/lib/journey';
import { WIZARD_STEPS } from '@/features/create-project/types';
import {
  experienceDisplayDescription,
  experienceDisplayName,
  isConceptOnlyGallery,
  portfolioProvenance,
  provenanceLabel,
} from '@/lib/catalog/presentation';
import { categoryLabel } from '@/lib/catalog/categories';
import { SHOWCASE_FILMS, galleryItems } from '@/lib/catalog/showcase';

/**
 * The journey used to be told three different ways — the homepage put photos
 * before the brief, How It Works led with the experience, and the wizard ran
 * idea → vision → photos → review. Someone reading two of those pages learns
 * that we do not know our own process, which is a credibility problem rather
 * than a copy problem.
 */
describe('one customer journey', () => {
  it('lists the brief steps in the order the wizard actually runs', () => {
    expect(JOURNEY_BRIEF_STEPS.map((step) => step.wizardStepId)).toEqual(
      WIZARD_STEPS.map((step) => step.id),
    );
  });

  it('numbers the customer’s steps and does not number ours', () => {
    expect(JOURNEY_BRIEF_STEPS.map((step) => step.step)).toEqual(['01', '02', '03', '04']);
    // Production is our work. Numbering it alongside the brief steps is what
    // made one process read as seven things the customer has to do.
    for (const stage of JOURNEY_PRODUCTION_STAGES) {
      expect(Object.keys(stage)).toEqual(['title', 'copy']);
    }
  });

  it('puts photos after the brief, everywhere', () => {
    const idea = JOURNEY_BRIEF_STEPS.findIndex((s) => /idea/i.test(s.title));
    const vision = JOURNEY_BRIEF_STEPS.findIndex((s) => /vision/i.test(s.title));
    const photos = JOURNEY_BRIEF_STEPS.findIndex((s) => /photo/i.test(s.title));
    const review = JOURNEY_BRIEF_STEPS.findIndex((s) => /review/i.test(s.title));
    expect(idea).toBeLessThan(vision);
    expect(vision).toBeLessThan(photos);
    expect(photos).toBeLessThan(review);
  });

  it('is the only source the marketing pages read the order from', () => {
    for (const page of ['app/(marketing)/page.tsx', 'app/(marketing)/how-it-works/page.tsx']) {
      expect(read(page), `${page} does not use the shared journey`).toContain(
        'JOURNEY_BRIEF_STEPS',
      );
    }
  });
});

/**
 * Nothing in the gallery has been delivered to a customer. Presenting concept
 * work as commissions would be inventing a client history — the kind of claim
 * that is both dishonest and eventually found out.
 */
describe('portfolio credibility', () => {
  it('treats anything unlabelled as a concept', () => {
    expect(portfolioProvenance({})).toBe('CONCEPT');
    expect(portfolioProvenance({ provenance: null })).toBe('CONCEPT');
    expect(provenanceLabel('CONCEPT')).toBe('Concept');
  });

  /**
   * The regression this exists to prevent. Provenance used to be derived from
   * whether a piece had media, which was true right up until we had real
   * concept films: both of these have genuine media and neither was
   * commissioned, so the old rule would have quietly promoted them.
   */
  it('keeps a concept a concept even though it now has real media', () => {
    for (const film of SHOWCASE_FILMS) {
      expect(film.videoUrl, film.slug).toMatch(/^\/showcase\/.+\.mp4$/);
      expect(film.provenance, film.slug).toBe('CONCEPT');
      expect(provenanceLabel(portfolioProvenance(film)), film.slug).toBe('Concept');
    }
  });

  it('only calls something a commission when something says so', () => {
    expect(portfolioProvenance({ provenance: 'COMMISSION' })).toBe('COMMISSION');
    expect(provenanceLabel('COMMISSION')).toBeNull();
  });

  it('knows when the whole gallery is concept work', () => {
    expect(isConceptOnlyGallery([{}, { provenance: null }])).toBe(true);
    expect(isConceptOnlyGallery([{}, { provenance: 'COMMISSION' }])).toBe(false);
  });

  it('leads the gallery with the films, without listing anything twice', () => {
    const items = galleryItems([
      {
        id: 'db-1',
        slug: 'monaco-summer',
        title: 'Monaco, Late Summer',
        description: null,
        category: 'LUXURY_LIFESTYLE',
        experienceSlug: 'luxury-lifestyle',
      },
      // A row that shares a slug with a declared film must not duplicate it.
      {
        id: 'db-2',
        slug: 'midnight-yacht',
        title: 'Midnight Yacht',
        description: null,
        category: 'LUXURY_LIFESTYLE',
        experienceSlug: 'luxury-lifestyle',
      },
    ]);

    expect(items.map((item) => item.slug)).toEqual([
      'midnight-yacht',
      'garden-wedding',
      'atelier-day',
      'executive-presence',
      'island-arrival',
      'monaco-summer',
    ]);
    expect(items[0]?.film?.videoUrl).toBe('/showcase/midnight-yacht.mp4');
    expect(items[5]?.film).toBeNull();
    // Still a concept gallery, media and all.
    expect(isConceptOnlyGallery(items)).toBe(true);
  });

  it('makes no claim of films delivered to customers', () => {
    for (const page of [
      'app/(marketing)/page.tsx',
      'app/(marketing)/portfolio/page.tsx',
      'app/(marketing)/how-it-works/page.tsx',
    ]) {
      const source = prose(page);
      expect(source, `${page} claims delivered work`).not.toMatch(/Films we have made/i);
      expect(source, `${page} claims commissions`).not.toMatch(/Recent commissions/i);
    }
  });
});

/**
 * Privacy claims have to match what the system enforces. Two earlier lines did
 * not: one said only the customer could open a project, which is false because
 * authorised staff must be able to; the other said no public link could ever be
 * created, which is false because short-lived signed URLs are the mechanism.
 */
describe('privacy copy accuracy', () => {
  const pages = [
    'app/(marketing)/page.tsx',
    'app/(marketing)/how-it-works/page.tsx',
    'app/(app)/create/page.tsx',
  ];

  it('never claims the customer is the only person with access', () => {
    for (const page of pages) {
      expect(prose(page), page).not.toMatch(/only you can open/i);
    }
  });

  it('never claims a per-project producer assignment the database does not model', () => {
    for (const page of pages) {
      expect(prose(page), page).not.toMatch(/producer assigned to your project/i);
    }
  });

  it('never denies that short-lived links exist, since they are how it works', () => {
    for (const page of pages) {
      expect(prose(page), page).not.toMatch(/none can be created/i);
    }
  });

  it('says who can actually reach a project', () => {
    expect(prose('app/(marketing)/page.tsx')).toMatch(/authorised production staff/i);
  });

  /**
   * Guard for the guard. If `stripComments` took too much, every assertion
   * above would pass against an empty string and prove nothing.
   */
  it('strips comments without stripping the copy', () => {
    const source = [
      '/** "Only you can open your project" was the old line. */',
      "const copy = 'Only authorised production staff can open it.';",
      '// "none can be created" used to appear here',
      'export const x = copy;',
    ].join('\n');

    const stripped = stripComments(source);
    expect(stripped).not.toMatch(/only you can open/i);
    expect(stripped).not.toMatch(/none can be created/i);
    expect(stripped).toMatch(/Only authorised production staff can open it\./);
  });

  it('is reading enough of each page for the assertions to mean something', () => {
    for (const page of pages) {
      expect(prose(page).length, page).toBeGreaterThan(500);
    }
  });
});

describe('experience naming', () => {
  it('renames the stored value for display without changing it', () => {
    // EXECUTIVE is written into an applied migration and into rows; only its
    // label moves.
    // The category is the kind of work; the experience is what somebody buys.
    // Both renamed without the stored value moving.
    expect(categoryLabel('EXECUTIVE')).toBe('Personal Brand');
    expect(categoryLabel('TRAVEL')).toBe('Travel & Adventure');
    expect(experienceDisplayName('executive', 'Executive')).toBe('Executive Presence');
  });

  it('falls through to the stored name for anything not overridden', () => {
    expect(experienceDisplayName('fashion', 'Fashion')).toBe('Fashion');
    expect(experienceDisplayDescription('fashion', 'Stored copy')).toBe('Stored copy');
  });

  it('reassures someone who does not know which direction they want', () => {
    expect(experienceDisplayDescription('bespoke', 'Stored copy')).toMatch(/not sure/i);
  });
});
