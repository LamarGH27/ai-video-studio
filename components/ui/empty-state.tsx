import * as React from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 rounded-panel border border-dashed border-white/12 px-6 py-16 text-center',
        className,
      )}
    >
      {icon ? <div className="text-bone-400/60">{icon}</div> : null}
      <div className="space-y-2">
        <p className="display-heading text-xl">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-bone-400">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
