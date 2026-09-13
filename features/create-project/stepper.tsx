'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WIZARD_STEPS, type WizardStepId } from './types';

/**
 * The progress rail.
 *
 * A filled track behind numbered marks, rather than four chips in a row: it
 * answers "how much is left" at a glance, which is the only question a person
 * halfway through a form is actually asking.
 *
 * On phones the labels collapse and a single line of text carries the same
 * information, because four labels at 375px is four truncated words.
 */
export function Stepper({
  current,
  furthestReached,
  onSelect,
}: {
  current: WizardStepId;
  furthestReached: WizardStepId;
  onSelect: (step: WizardStepId) => void;
}) {
  const total = WIZARD_STEPS.length;
  const progress = ((current - 1) / (total - 1)) * 100;
  const currentStep = WIZARD_STEPS.find((step) => step.id === current);

  return (
    <nav aria-label="Progress">
      {/* Phone: one honest line, plus the same rail. */}
      <p className="mb-4 flex items-baseline justify-between gap-4 sm:hidden">
        <span className="display-heading text-lg">{currentStep?.label}</span>
        <span className="text-xs tracking-[0.18em] text-bone-500 uppercase">
          Step {current} of {total}
        </span>
      </p>

      <div className="relative">
        {/* The track sits behind the marks and is purely decorative — the list
            below carries the real state for assistive technology. */}
        <div
          aria-hidden="true"
          className="absolute top-4 right-0 left-0 h-px bg-white/12 sm:top-4.5"
        />
        <div
          aria-hidden="true"
          className="absolute top-4 left-0 h-px bg-brass-400/70 transition-[width] duration-700 ease-cinema sm:top-4.5"
          style={{ width: `${progress}%` }}
        />

        <ol className="relative flex justify-between">
          {WIZARD_STEPS.map((step) => {
            const isComplete = step.id < current;
            const isCurrent = step.id === current;
            const isReachable = step.id <= furthestReached;

            return (
              <li key={step.id} className="flex">
                <button
                  type="button"
                  onClick={() => isReachable && onSelect(step.id)}
                  disabled={!isReachable}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'group flex flex-col items-start gap-2.5 rounded-lg text-left transition-opacity',
                    isReachable ? 'cursor-pointer' : 'cursor-default opacity-45',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors sm:size-9',
                      // The ground is opaque so the track appears to pass behind.
                      'bg-ink-990',
                      isCurrent && 'border-brass-400 bg-brass-400 text-ink-990',
                      isComplete && !isCurrent && 'border-brass-400/50 text-brass-300',
                      !isCurrent && !isComplete && 'border-white/20 text-bone-500',
                      isReachable && !isCurrent && 'group-hover:border-white/45',
                    )}
                  >
                    {isComplete ? (
                      <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                    ) : (
                      step.id
                    )}
                  </span>

                  <span className="hidden sm:block">
                    <span
                      className={cn(
                        'block text-sm transition-colors',
                        isCurrent ? 'text-bone-50' : 'text-bone-400 group-hover:text-bone-200',
                      )}
                    >
                      {step.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-bone-500">{step.hint}</span>
                  </span>

                  <span className="sr-only">
                    Step {step.id} of {total}: {step.label}
                    {isComplete ? ' (completed)' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
