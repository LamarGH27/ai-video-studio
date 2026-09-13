import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Buttons.
 *
 * Pill-shaped, because a rounded-full control reads as an invitation and a
 * rectangle reads as a form field. The accent variant is the only saturated
 * surface in routine use, so it always means "this is the thing to press".
 *
 * Every size clears the 44px touch target at `md` and above; `sm` is for dense
 * admin rows where a pointer is a fair assumption, and still hits 36px.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full',
    'font-medium tracking-[-0.005em]',
    'transition-[background-color,color,border-color,opacity,transform,box-shadow] duration-300',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    // A 1px lift on hover. Enough to feel responsive, not enough to bounce.
    'motion-safe:hover:-translate-y-px',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-bone-50 text-ink-990 hover:bg-white',
        accent:
          'bg-brass-400 text-ink-990 hover:bg-brass-300 shadow-[0_1px_0_0_oklch(1_0_0/0.25)_inset]',
        outline:
          'border border-bone-50/22 text-bone-50 hover:border-bone-50/55 hover:bg-white/[0.06]',
        ghost: 'text-bone-300 hover:bg-white/5 hover:text-bone-50',
        danger: 'border border-rose-400/40 text-rose-200 hover:bg-rose-500/10',
        link: 'text-brass-300 underline-offset-[6px] hover:underline rounded-sm motion-safe:hover:translate-y-0',
      },
      size: {
        sm: 'h-9 px-4 text-sm',
        md: 'h-11 px-6 text-sm',
        lg: 'h-13 px-8 text-base',
        xl: 'h-14 px-9 text-base sm:h-15 sm:px-11',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
