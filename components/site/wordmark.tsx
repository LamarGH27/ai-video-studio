import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Temporary working brand. Replace wholesale when the real identity lands. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn('group inline-flex items-baseline gap-2', className)}
      aria-label="AI Video Studio — home"
    >
      <span className="display-heading text-[1.05rem] tracking-tight">AI Video Studio</span>
      <span
        aria-hidden="true"
        className="hidden h-px w-6 bg-brass-400/50 transition-all group-hover:w-9 sm:block"
      />
    </Link>
  );
}
