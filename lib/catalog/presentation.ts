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
 * Provenance of a showcase piece.
 *
 * We have not yet delivered a customer film we hold public consent to show, so
 * everything in the gallery is a concept we made to demonstrate a direction.
 * Presenting those as commissions would be inventing a client history, which is
 * both dishonest and the kind of thing that is found out.
 *
 * The rule is derived rather than stored, so it needs no migration and cannot
 * go stale: a piece with no media is a concept, because there is no film to
 * show. The moment a genuine consented delivery is published with its
 * `media_url`, it stops being labelled a concept by itself — and until then the
 * label is accurate by construction.
 */
export type PortfolioProvenance = 'CONCEPT' | 'COMMISSION';

export function portfolioProvenance(entry: { mediaUrl: string | null }): PortfolioProvenance {
  return entry.mediaUrl === null ? 'CONCEPT' : 'COMMISSION';
}

export function provenanceLabel(provenance: PortfolioProvenance): string | null {
  return provenance === 'CONCEPT' ? 'Concept' : null;
}

/** The gallery is entirely concept work while nothing has been published with media. */
export function isConceptOnlyGallery(entries: readonly { mediaUrl: string | null }[]): boolean {
  return entries.every((entry) => portfolioProvenance(entry) === 'CONCEPT');
}

/** Categories whose naming the interface overrides; used by the catalogue tests. */
export const OVERRIDDEN_CATEGORY: ExperienceCategory = 'EXECUTIVE';
