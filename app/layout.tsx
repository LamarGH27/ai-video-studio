import type { Metadata, Viewport } from 'next';
import { siteUrl } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: 'AI Video Studio — Your photos. Your vision. Your movie.',
    template: '%s · AI Video Studio',
  },
  description:
    'Turn existing photographs into bespoke cinematic AI-generated video experiences, produced to brief.',
  openGraph: {
    title: 'AI Video Studio',
    description: 'Turn existing photographs into bespoke cinematic AI-generated video experiences.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0b0b0d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
