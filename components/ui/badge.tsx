import * as React from 'react';
import { cn } from '@/lib/utils';

export function Badge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide',
        'border-white/15 bg-white/5 text-bone-200',
        className,
      )}
      {...props}
    />
  );
}
