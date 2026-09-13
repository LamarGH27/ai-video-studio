import { Inter, Instrument_Serif } from 'next/font/google';

/**
 * Two families, and no more.
 *
 * A serif for display and a grotesque for interface is the oldest editorial
 * pairing there is, and it is the one that reads as a magazine rather than as
 * software. Instrument Serif is a modern high-contrast face with exactly one
 * weight, which is the point: display type is used at 40-90px where a single
 * weight is plenty, and every extra weight is another file on the critical path.
 *
 * Inter carries the interface. It ships as one variable file, so the whole
 * weight range costs what a single static weight would.
 *
 * Both are self-hosted: next/font downloads them at build time and serves them
 * from this origin, so there is no request to a third party when a page loads,
 * no extra DNS and TLS handshake, and nothing to leak a visitor's IP to a font
 * CDN. `display: swap` means text is readable before the face arrives.
 */

export const displayFont = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-display-face',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

export const sansFont = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans-face',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});
