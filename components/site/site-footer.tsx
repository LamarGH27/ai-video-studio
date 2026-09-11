import Link from 'next/link';
import { Container } from './container';

const FOOTER_LINKS = [
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/create', label: 'Create My Video' },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/8 py-14">
      <Container className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs space-y-3">
          <p className="display-heading text-lg">AI Video Studio</p>
          <p className="text-sm leading-relaxed text-bone-400">
            Bespoke cinematic AI-generated video, made from photographs you already have.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-col gap-3">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-bone-400 transition-colors hover:text-bone-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </Container>

      <Container className="mt-12 flex flex-col gap-2 border-t border-white/8 pt-8 text-xs text-bone-400/70 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} AI Video Studio. All rights reserved.</p>
        <p>Adults only. We only work from images you are permitted to use.</p>
      </Container>
    </footer>
  );
}
