/**
 * The brand, in one place.
 *
 * The product name is not yet settled — "Scenelio" is a candidate and the
 * domain is not bought — so nothing in the interface hard-codes it. Every
 * surface that says the name, the tagline or how to reach us reads it from
 * here, which means renaming the product is editing this file rather than
 * grepping for a string across forty components and missing three of them.
 *
 * An environment override exists so a preview deployment can carry a different
 * name without a code change. It is deliberately NEXT_PUBLIC_: this is the
 * least secret thing in the system, and the wordmark renders in the browser.
 */

const configuredName = (process.env.NEXT_PUBLIC_BRAND_NAME ?? '').trim();

export const brand = {
  /** The product name, as it appears everywhere a person reads it. */
  name: configuredName.length > 0 ? configuredName : 'AI Video Studio',

  /** One line, for the header of a page and the subject of a document. */
  tagline: 'Your photos. Your vision. Your movie.',

  /** One sentence, for a meta description or an introduction. */
  proposition: 'Turn the moments you imagine into cinematic experiences starring you.',

  /**
   * How the studio describes what it does, without saying "AI-powered
   * platform". The customer is buying an experience, not an algorithm.
   */
  descriptor: 'Cinematic films made from your photographs',

  contact: {
    /** Shown to customers. Replace when a real mailbox exists. */
    email: 'hello@example.com',
    /** Used in email footers and the support line on error states. */
    supportLabel: 'our team',
  },

  /** Kept for legal lines and copyright notices. */
  legalName: 'AI Video Studio',
} as const;

/** `2024–2026 Name` for a footer, without a hydration mismatch on New Year. */
export function copyrightLine(year: number): string {
  return `© ${year} ${brand.legalName}`;
}
