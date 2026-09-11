/**
 * PLACEHOLDER PRICING — NOT A COMMERCIAL OFFER.
 *
 * Every figure and inclusion below is demo content for the MVP. No payment is
 * taken anywhere in this codebase and nothing here is wired to a billing system.
 * Replace this file wholesale (and remove the banner on /pricing) when real
 * commercial pricing is agreed.
 */

export interface PlaceholderPackage {
  slug: 'starter' | 'cinematic' | 'premium';
  name: string;
  summary: string;
  /** Deliberately vague and clearly marked so it cannot read as a real quote. */
  indicativePrice: string;
  includes: readonly string[];
  highlighted: boolean;
}

export const PLACEHOLDER_PACKAGES: readonly PlaceholderPackage[] = [
  {
    slug: 'starter',
    name: 'Starter',
    summary: 'A single short film from one set of references. Good for a first commission.',
    indicativePrice: 'TBC',
    includes: [
      'One film, up to 15 seconds',
      'One orientation',
      'Up to 10 reference images',
      'One round of revisions',
    ],
    highlighted: false,
  },
  {
    slug: 'cinematic',
    name: 'Cinematic',
    summary: 'A longer, graded piece with more production attention on the brief.',
    indicativePrice: 'TBC',
    includes: [
      'One film, up to 30 seconds',
      'Two orientations delivered',
      'Up to 10 reference images',
      'Two rounds of revisions',
      'Producer review of your brief',
    ],
    highlighted: true,
  },
  {
    slug: 'premium',
    name: 'Premium',
    summary: 'A bespoke concept developed with you, delivered as a small set of films.',
    indicativePrice: 'TBC',
    includes: [
      'Up to three films, up to 60 seconds each',
      'All orientations delivered',
      'Up to 10 reference images',
      'Unlimited revisions within scope',
      'Concept development from the brief up',
    ],
    highlighted: false,
  },
] as const;
