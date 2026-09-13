import Link from 'next/link';
import { brand } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * The wordmark.
 *
 * No logo file yet, so the mark IS the typography: the display serif set tight,
 * with an aperture rule that opens on hover. The name comes from lib/brand so
 * that renaming the product does not mean editing a component.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn('group inline-flex items-center gap-2.5', className)}
      aria-label={`${brand.name} — home`}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-brass-400 transition-transform duration-500 group-hover:scale-150"
      />
      <span className="display-heading text-[1.15rem] tracking-[-0.01em]">{brand.name}</span>
      <span
        aria-hidden="true"
        className="hidden h-px w-5 bg-brass-400/45 transition-all duration-500 group-hover:w-10 group-hover:bg-brass-400/80 sm:block"
      />
    </Link>
  );
}
