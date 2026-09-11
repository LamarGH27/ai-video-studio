import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full rounded-lg border border-white/12 bg-white/[0.03] px-3.5 py-2 text-sm text-bone-50 transition-colors',
        'placeholder:text-bone-400/60',
        'hover:border-white/20',
        'focus-visible:border-brass-400/60 focus-visible:bg-white/[0.05]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-rose-400/70',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-bone-200',
        className,
      )}
      {...props}
    />
  );
}
