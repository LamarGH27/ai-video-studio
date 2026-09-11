import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden="true" />
      <span className="sr-only">{label ?? 'Loading'}</span>
    </span>
  );
}
