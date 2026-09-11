'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-5 shrink-0 rounded-[5px] border border-white/25 bg-white/[0.03] transition-colors',
        'hover:border-white/45',
        'data-[state=checked]:border-brass-400 data-[state=checked]:bg-brass-400 data-[state=checked]:text-ink-950',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-rose-400/70',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
