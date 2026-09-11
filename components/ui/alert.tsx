import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type AlertTone = 'info' | 'success' | 'error';

const TONE_STYLES: Record<AlertTone, string> = {
  info: 'border-white/12 bg-white/[0.03] text-bone-200',
  success: 'border-emerald-400/30 bg-emerald-400/5 text-emerald-100',
  error: 'border-rose-400/35 bg-rose-500/5 text-rose-100',
};

const TONE_ICONS: Record<AlertTone, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = TONE_ICONS[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border p-4 text-sm', TONE_STYLES[tone], className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="leading-relaxed opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
