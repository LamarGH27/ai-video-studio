import type { Metadata, Viewport } from 'next';
import { siteUrl } from '@/lib/env';
import { brand } from '@/lib/brand';
import { displayFont, sansFont } from '@/lib/brand/fonts';
import './globals.css';

export const metadata: Metadata = {
  // Resolved at build from NEXT_PUBLIC_SITE_URL, falling back to the Vercel
  // preview origin and then localhost. No production host is written here:
  // scenelio.co.uk becomes canonical by setting that variable, not by editing
  // this file, so previews keep resolving to themselves.
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.proposition,
  applicationName: brand.name,
  /**
   * Self-canonical, resolved against metadataBase.
   *
   * `'./'` is per-route: /portfolio canonicalises to <origin>/portfolio. That
   * matters most for the hosts we do NOT advertise — a production deployment
   * keeps its *.vercel.app alias, and that alias is reachable and indexable. A
   * crawler that finds it now reads a canonical pointing at the real domain
   * instead of competing with it.
   *
   * A preview deployment canonicalises to ITSELF, which is correct: it is not
   * production and must not claim to be. The origin comes from siteUrl(), so
   * which host that is stays a deployment decision, not a source-code one.
   */
  alternates: { canonical: './' },
  openGraph: {
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.proposition,
    siteName: brand.name,
    url: './',
    type: 'website',
  },
  // No card image yet, so a summary card rather than a large one that would
  // render as an empty box. Upgrade to summary_large_image with the OG asset.
  twitter: {
    card: 'summary',
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.proposition,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${sansFont.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:rounded-full focus:bg-bone-50 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink-950"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
