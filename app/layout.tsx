import type { Metadata, Viewport } from 'next';
import { siteUrl } from '@/lib/env';
import { brand } from '@/lib/brand';
import { displayFont, sansFont } from '@/lib/brand/fonts';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.proposition,
  openGraph: {
    title: brand.name,
    description: brand.proposition,
    type: 'website',
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
