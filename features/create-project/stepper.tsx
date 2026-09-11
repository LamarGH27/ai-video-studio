'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WIZARD_STEPS, type WizardStepId } from './types';

export function Stepper({
  current,
  furthestReached,
  onSelect,
}: {
  current: WizardStepId;
  furthestReached: WizardStepId;
  onSelect: (step: WizardStepId) => void;
}) {
  return (
    <nav aria-label="Progress">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3 sm:gap-x-4">
        {WIZARD_STEPS.map((step, index) => {
          const isComplete = step.id < current;
          const isCurrent = step.id === current;
          const isReachable = step.id <= furthestReached;

          return (
            <li key={step.id} className="flex items-center gap-2 sm:gap-4">
              <button
                type="button"
                onClick={() => isReachable && onSelect(step.id)}
                disabled={!isReachable}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 text-sm transition-colors',
                  isReachable ? 'cursor-pointer hover:bg-white/5' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                    isCurrent && 'border-brass-400 bg-brass-400 text-ink-950',
                    isComplete && !isCurrent && 'border-brass-400/40 text-brass-300',
                    !isCurrent && !isComplete && 'border-white/20 text-bone-400',
                  )}
                >
                  {isComplete ? (
                    <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                  ) : (
                    step.id
                  )}
                </span>
                <span
                  className={cn('hidden sm:inline', isCurrent ? 'text-bone-50' : 'text-bone-400')}
                >
                  {step.label}
                </span>
                <span className="sr-only">
                  Step {step.id} of {WIZARD_STEPS.length}: {step.label}
                  {isComplete ? ' (completed)' : ''}
                </span>
              </button>

              {index < WIZARD_STEPS.length - 1 ? (
                <span aria-hidden="true" className="h-px w-4 bg-white/15 sm:w-8" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
