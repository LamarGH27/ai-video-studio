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
   * The legal operator. Deliberately null, and deliberately not `name`.
   *
   * Scenelio is a trading brand. No company of that name has been registered
   * and no operating entity has been supplied, so there is nothing truthful to
   * put here — and a field called `legalName` holding a trading name is worse
   * than an empty one, because the next person to need a legal identity finds
   * it already populated and ships it.
   *
   * Nothing reads this today. The copyright line uses `name`, which is correct:
   * a notice may name the trading brand and asserts no incorporation.
   *
   * These surfaces WILL need a real value, and none of them exists yet:
   *   - Terms of Service and Privacy Policy. UK GDPR requires the data
   *     controller to be identified by name and address; "Scenelio" alone does
   *     not satisfy that.
   *   - Any marketing email. PECR/CAN-SPAM require the sender's identity and a
   *     postal address. Transactional mail is exempt and says so in its own
   *     footer, which is why the current templates are fine.
   *   - Stripe. The merchant of record and the card statement descriptor are
   *     the registered entity, not the brand.
   *
   * Typed `null` on purpose: `as const` narrows it, so any consumer written
   * before an entity exists has to handle its absence rather than rendering
   * "null" or silently falling back to the brand.
   */
  legalEntity: null,
} as const;

/**
 * `© 2026 Name` for a footer, without a hydration mismatch on New Year.
 *
 * Names the trading brand, not an entity. A copyright notice does not assert
 * incorporation, and this must never quietly gain "Ltd" — see `legalEntity`.
 */
export function copyrightLine(year: number): string {
  return `© ${year} ${brand.name}`;
}
