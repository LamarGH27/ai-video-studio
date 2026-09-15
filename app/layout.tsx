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
  openGraph: {
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.proposition,
    siteName: brand.name,
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
