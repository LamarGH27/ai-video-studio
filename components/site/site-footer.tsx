import Link from 'next/link';
import type { Route } from 'next';
import { brand, copyrightLine } from '@/lib/brand';
import { Container } from './container';

const EXPLORE: readonly { href: Route; label: string }[] = [
  { href: '/#experiences' as Route, label: 'Experiences' },
  { href: '/portfolio' as Route, label: 'Concept Gallery' },
  { href: '/how-it-works' as Route, label: 'How It Works' },
];

const ACCOUNT: readonly { href: Route; label: string }[] = [
  { href: '/create' as Route, label: 'Create My Video' },
  { href: '/dashboard' as Route, label: 'Your projects' },
  { href: '/login' as Route, label: 'Sign in' },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto surface-glow-soft rule-top">
      <Container className="grid gap-12 py-16 sm:py-20 lg:grid-cols-12 lg:gap-10">
        <div className="max-w-sm lg:col-span-5">
          <p className="display-heading text-2xl">{brand.name}</p>
          <p className="mt-4 leading-relaxed text-bone-400">{brand.proposition}</p>
        </div>

        <nav aria-label="Explore" className="lg:col-span-3 lg:col-start-7">
          <p className="text-xs tracking-[0.2em] text-bone-500 uppercase">Explore</p>
          <ul className="mt-5 space-y-3">
            {EXPLORE.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-bone-400 transition-colors hover:text-bone-50"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Your account" className="lg:col-span-3">
          <p className="text-xs tracking-[0.2em] text-bone-500 uppercase">Your account</p>
          <ul className="mt-5 space-y-3">
            {ACCOUNT.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-bone-400 transition-colors hover:text-bone-50"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>

      <Container className="flex flex-col gap-3 py-8 text-xs text-bone-500 rule-top sm:flex-row sm:items-center sm:justify-between">
        <p>{copyrightLine(new Date().getFullYear())}</p>
        <p>Adults only. We work only from images you hold permission to use.</p>
      </Container>
    </footer>
  );
}
