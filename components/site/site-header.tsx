import Link from 'next/link';
import type { Route } from 'next';
import { getProfile } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Container } from './container';
import { Wordmark } from './wordmark';
import { MobileNav, type NavLink } from './mobile-nav';

/**
 * Four links and one action.
 *
 * Pricing moved to the footer: it is provisional, and putting a provisional
 * number in front of someone before they have seen the work is asking them to
 * price something they do not yet want. The order here is the order of the
 * page — inspiration, then process, then proof.
 */
const NAV_LINKS: readonly NavLink[] = [
  { href: '/#experiences' as Route, label: 'Experiences' },
  { href: '/how-it-works' as Route, label: 'How It Works' },
  { href: '/portfolio' as Route, label: 'Portfolio' },
] as const;

export async function SiteHeader() {
  // The marketing site must render without Supabase configured, so the session
  // lookup is skipped rather than allowed to throw.
  const profile = isSupabaseConfigured() ? await getProfile() : null;
  const isAuthenticated = profile !== null;
  const isAdmin = profile?.role === 'admin';

  return (
    <header
      className={[
        'sticky top-0 z-50',
        // Translucent rather than solid: the page reads as one continuous
        // surface scrolling beneath a pane of glass, which is most of why a
        // sticky bar feels expensive rather than bolted on.
        'border-b border-white/[0.07] bg-ink-990/70 backdrop-blur-xl',
        'supports-[backdrop-filter]:bg-ink-990/55',
      ].join(' ')}
    >
      <Container className="relative flex h-[4.5rem] items-center justify-between gap-6">
        <Wordmark />

        <nav aria-label="Main" className="hidden items-center gap-9 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group relative text-sm text-bone-400 transition-colors hover:text-bone-50"
            >
              {link.label}
              {/* The rule draws in from the left on hover — a nod to a film
                  slate, and cheaper than a colour change to notice. */}
              <span
                aria-hidden="true"
                className="absolute -bottom-1.5 left-0 h-px w-0 bg-brass-400 transition-all duration-400 group-hover:w-full"
              />
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-5 md:flex">
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
            {isAuthenticated ? 'Your projects' : 'Sign In'}
          </Link>
          <Button asChild variant="accent" size="sm">
            <Link href="/create">Create My Video</Link>
          </Button>
        </div>

        <MobileNav links={NAV_LINKS} isAuthenticated={isAuthenticated} isAdmin={isAdmin} />
      </Container>
    </header>
  );
}
