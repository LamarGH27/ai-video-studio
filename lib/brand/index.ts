/**
 * The brand, in one place.
 *
 * The product is Scenelio, and scenelio.co.uk is owned. Nothing in the
 * interface hard-codes that: every surface that says the name, the tagline or
 * how to reach us reads it from here, which is why the rename from the old
 * working name was this file plus an email constant rather than a grep across
 * forty components that misses three of them.
 *
 * The brand is not the infrastructure. The repository, the Supabase project,
 * the storage buckets and the AVS- project reference all keep the names they
 * were created with, because renaming deployed infrastructure to match a public
 * name is risk spent on nothing a customer will ever see.
 *
 * An environment override exists so a preview deployment can carry a different
 * name without a code change. It is deliberately NEXT_PUBLIC_: this is the
 * least secret thing in the system, and the wordmark renders in the browser.
 */

const configuredName = (process.env.NEXT_PUBLIC_BRAND_NAME ?? '').trim();

export const brand = {
  /** The product name, as it appears everywhere a person reads it. */
  name: configuredName.length > 0 ? configuredName : 'Scenelio',

  /** One line, for the header of a page and the subject of a document. */
  tagline: 'Your photos. Your vision. Your movie.',

  /** One sentence, for a meta description or an introduction. */
  proposition: 'Turn the moments you imagine into cinematic experiences starring you.',

  /**
   * How the studio describes what it does, without saying "AI-powered
   * platform". The customer is buying an experience, not an algorithm.
   */
  descriptor: 'Cinematic films made from your photographs',

  /**
   * Name and descriptor in one line, for the places a machine reads: a search
   * result, a shared link, an application name. Never shown as a tagline —
   * `tagline` is what a person sees.
   */
  summary: `${configuredName.length > 0 ? configuredName : 'Scenelio'} — personalised cinematic films from your photos`,

  contact: {
    /** Shown to customers. Replace when a real mailbox exists. */
    email: 'hello@example.com',
    /** Used in email footers and the support line on error states. */
    supportLabel: 'our team',
  },

  /**
   * For copyright lines. The product name, because no legal entity is
   * registered — this deliberately does not say "Ltd" until one exists.
   */
  legalName: 'Scenelio',
} as const;

/** `2024–2026 Name` for a footer, without a hydration mismatch on New Year. */
export function copyrightLine(year: number): string {
  return `© ${year} ${brand.legalName}`;
}
