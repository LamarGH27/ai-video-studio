import type { ExperienceCategory } from '@/types/database';

/**
 * Human-facing names and supporting copy for catalogue rows.
 *
 * `video_experiences.name` and `video_experiences.description` are seeded by an
 * applied migration and are therefore fixed. This module lets the interface say
 * something better without a migration, and without the two ever disagreeing:
 * anything not overridden falls through to the stored value.
 *
 * Keyed by slug, which is the stable identifier a person can actually read.
 */

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  // "Executive" alone sounded like a job title rather than a kind of film.
  executive: 'Executive Presence',
  bespoke: 'Bespoke',
};

const DISPLAY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  executive:
    'Composure and authority for founders and leaders. Considered framing, restrained movement, built to be taken seriously.',
  // The people who need this option most are the ones least sure they are
  // allowed to use it, so the copy says so plainly.
  bespoke:
    'Not sure which direction fits? Start here and describe what you have in mind — there is no template to work around.',
};

export function experienceDisplayName(slug: string, storedName: string): string {
  return DISPLAY_NAMES[slug] ?? storedName;
}

export function experienceDisplayDescription(slug: string, storedDescription: string): string {
  return DISPLAY_DESCRIPTIONS[slug] ?? storedDescription;
}

/**
 * Provenance of a showcase piece. Stated, never inferred.
 *
 * This used to be derived — a piece with no media was a concept, because there
 * was no film to show. That rule died the moment we had real concept films:
 * Midnight Yacht and Garden Wedding both have genuine media and are both still
 * demonstrations we made ourselves, so "has media" would have silently promoted
 * them to commissions. Inventing a client history is exactly the failure this
 * function exists to prevent.
 *
 * So the rule is now the conservative one: a piece is a commission only where
 * something says so explicitly. Anything unlabelled — every `portfolio_items`
 * row, since the table has no provenance column and migrations 000000-000700
 * are immutable — is a concept. Being wrong in that direction understates our
 * work; being wrong in the other direction is a lie.
 *
 * lib/catalog/showcase.ts is where the two real films state theirs.
 */
export type PortfolioProvenance = 'CONCEPT' | 'COMMISSION';

export function portfolioProvenance(entry: {
  provenance?: PortfolioProvenance | null;
}): PortfolioProvenance {
  return entry.provenance ?? 'CONCEPT';
}

export function provenanceLabel(provenance: PortfolioProvenance): string | null {
  return provenance === 'CONCEPT' ? 'Concept' : null;
}

/** The gallery is entirely concept work until something is explicitly a commission. */
export function isConceptOnlyGallery(
  entries: readonly { provenance?: PortfolioProvenance | null }[],
): boolean {
  return entries.every((entry) => portfolioProvenance(entry) === 'CONCEPT');
}

/** Categories whose naming the interface overrides; used by the catalogue tests. */
export const OVERRIDDEN_CATEGORY: ExperienceCategory = 'EXECUTIVE';
