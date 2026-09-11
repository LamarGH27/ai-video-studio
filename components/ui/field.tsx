import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Form field scaffolding.
 *
 * Wires the label, description and error message to the control with
 * `htmlFor` / `aria-describedby` / `aria-invalid`, so validation errors are
 * announced by a screen reader rather than only shown in red.
 *
 * Children receive the generated ids — render them with `field.controlProps`.
 */
export interface FieldRenderProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean | undefined;
}

interface FieldProps {
  id: string;
  label: string;
  description?: string;
  error?: string | undefined;
  required?: boolean;
  optionalHint?: boolean;
  className?: string;
  children: (props: FieldRenderProps) => React.ReactNode;
}

export function Field({
  id,
  label,
  description,
  error,
  required,
  optionalHint,
  className,
  children,
}: FieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-bone-200">
          {label}
          {required ? (
            <span className="ml-1 text-brass-300" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {optionalHint ? <span className="text-xs text-bone-400/70">Optional</span> : null}
      </div>

      {description ? (
        <p id={descriptionId} className="text-xs leading-relaxed text-bone-400">
          {description}
        </p>
      ) : null}

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
