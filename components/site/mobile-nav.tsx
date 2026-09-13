'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Route } from 'next';

export interface NavLink {
  href: Route;
  label: string;
}

/**
 * The phone menu.
 *
 * Most people will meet this product through a link in a social app, so this is
 * the first navigation the majority of visitors touch — it gets full-height
 * treatment and display-sized targets rather than a cramped dropdown.
 *
 * It closes on Escape, on navigation, and locks the page behind it while open
 * so the background does not scroll under a full-screen panel.
 */
export function MobileNav({
  links,
  isAuthenticated,
  isAdmin = false,
}: {
  links: readonly NavLink[];
  isAuthenticated: boolean;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex size-11 items-center justify-center rounded-full border border-white/15 text-bone-200 transition-colors hover:border-white/30 hover:text-bone-50"
      >
        {open ? (
          <X className="size-5" aria-hidden="true" />
        ) : (
          <Menu className="size-5" aria-hidden="true" />
        )}
        <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="fixed inset-x-0 top-[4.5rem] bottom-0 z-50 overflow-y-auto border-t border-white/10 bg-ink-990/98 backdrop-blur-xl"
      >
        <nav aria-label="Main" className="flex min-h-full flex-col px-5 pt-6 pb-10">
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-4 display-heading text-3xl transition-colors hover:bg-white/5"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-8 space-y-1 border-t border-white/10 pt-6">
            {isAdmin ? (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-3.5 text-bone-300 transition-colors hover:bg-white/5 hover:text-bone-50"
              >
                Admin
              </Link>
            ) : null}
            <Link
              href={isAuthenticated ? '/dashboard' : '/login'}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-3.5 text-bone-300 transition-colors hover:bg-white/5 hover:text-bone-50"
            >
              {isAuthenticated ? 'Your projects' : 'Sign In'}
            </Link>
          </div>

          <Button asChild variant="accent" size="lg" className="mt-8 w-full">
            <Link href="/create" onClick={() => setOpen(false)}>
              Create My Video
            </Link>
          </Button>
        </nav>
      </div>
    </div>
  );
}
