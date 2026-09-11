import * as React from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex w-full rounded-lg border border-white/12 bg-white/[0.03] px-3.5 py-3 text-sm leading-relaxed text-bone-50 transition-colors',
        'placeholder:text-bone-400/60',
        'hover:border-white/20',
        'focus-visible:border-brass-400/60 focus-visible:bg-white/[0.05]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-rose-400/70',
        className,
      )}
      {...props}
    />
  );
}
