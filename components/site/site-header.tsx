import Link from 'next/link';
import type { Route } from 'next';
import { getProfile } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Container } from './container';
import { Wordmark } from './wordmark';
import { MobileNav, type NavLink } from './mobile-nav';

const NAV_LINKS: readonly NavLink[] = [
  { href: '/portfolio' as Route, label: 'Portfolio' },
  { href: '/how-it-works' as Route, label: 'How It Works' },
  { href: '/pricing' as Route, label: 'Pricing' },
] as const;

export async function SiteHeader() {
  // The marketing site must render without Supabase configured, so the session
  // lookup is skipped rather than allowed to throw.
  const profile = isSupabaseConfigured() ? await getProfile() : null;
  const isAuthenticated = profile !== null;
  const isAdmin = profile?.role === 'admin';

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-ink-950/85 backdrop-blur-md">
      <Container className="relative flex h-16 items-center justify-between gap-6">
        <Wordmark />

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-bone-400 transition-colors hover:text-bone-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {isAdmin ? (
            <Link
              href="/admin"
              className="text-sm text-bone-400 transition-colors hover:text-bone-50"
            >
              Admin
            </Link>
          ) : null}
          <Link
            href={isAuthenticated ? '/dashboard' : '/login'}
            className="text-sm text-bone-400 transition-colors hover:text-bone-50"
          >
            {isAuthenticated ? 'Dashboard' : 'Sign in'}
          </Link>
          <Button asChild variant="accent" size="sm">
            <Link href="/create">Create My Video</Link>
          </Button>
        </div>

        <MobileNav links={NAV_LINKS} isAuthenticated={isAuthenticated} />
      </Container>
    </header>
  );
}
