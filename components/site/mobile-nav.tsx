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

export function MobileNav({
  links,
  isAuthenticated,
}: {
  links: readonly NavLink[];
  isAuthenticated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-bone-100 inline-flex size-10 items-center justify-center rounded-full border border-white/15"
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
        className="absolute inset-x-0 top-full border-b border-white/10 bg-ink-950/98 px-5 pb-6 backdrop-blur"
      >
        <nav aria-label="Main" className="flex flex-col gap-1 pt-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-sm text-bone-200 hover:bg-white/5 hover:text-bone-50"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href={isAuthenticated ? '/dashboard' : '/login'}
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-3 text-sm text-bone-200 hover:bg-white/5 hover:text-bone-50"
          >
            {isAuthenticated ? 'Dashboard' : 'Sign in'}
          </Link>
          <Button asChild variant="accent" className="mt-3 w-full">
            <Link href="/create" onClick={() => setOpen(false)}>
              Create My Video
            </Link>
          </Button>
        </nav>
      </div>
    </div>
  );
}
