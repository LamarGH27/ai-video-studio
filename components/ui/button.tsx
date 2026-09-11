import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[background-color,color,border-color,opacity] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-bone-50 text-ink-950 hover:bg-white',
        accent: 'bg-brass-400 text-ink-950 hover:bg-brass-300',
        outline: 'border border-bone-50/25 text-bone-50 hover:border-bone-50/60 hover:bg-white/5',
        ghost: 'text-bone-200 hover:bg-white/5 hover:text-bone-50',
        danger: 'border border-rose-400/40 text-rose-200 hover:bg-rose-500/10',
        link: 'text-brass-300 underline-offset-4 hover:underline rounded-sm',
      },
      size: {
        sm: 'h-9 px-4',
        md: 'h-11 px-6',
        lg: 'h-13 px-8 text-base',
        icon: 'size-10',
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
