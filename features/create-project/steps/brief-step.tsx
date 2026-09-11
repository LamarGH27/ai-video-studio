'use client';

import { useForm, useWatch, Controller } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  DURATION_PRESETS,
  MAX_BRIEF_LENGTH,
  briefFormSchema,
  type BriefFormValues,
} from '@/lib/validation/project';
import { PROJECT_ORIENTATIONS, orientationMeta } from '@/lib/projects/status';
import type { DraftValues } from '../types';

const BRIEF_EXAMPLE =
  'I want to walk through a luxury yacht in Monaco wearing an elegant summer outfit. The mood should feel confident, sophisticated and cinematic.';

/**
 * Step 2 — the creative brief.
 *
 * Validated client-side with the same limits the server enforces, so the
 * customer gets immediate feedback. The server re-parses everything regardless.
 */
export function BriefStep({
  values,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  values: DraftValues;
  onBack: () => void;
  onSubmit: (values: BriefFormValues) => void;
  submitting: boolean;
  error: string | null;
}) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<BriefFormValues>({
    resolver: standardSchemaResolver(briefFormSchema),
    mode: 'onBlur',
    defaultValues: {
      brief: values.brief,
      mood: values.mood,
      environment: values.environment,
      wardrobeStyle: values.wardrobeStyle,
      orientation: values.orientation ?? 'VERTICAL_9_16',
      desiredDurationSeconds: values.desiredDurationSeconds,
      specialRequirements: values.specialRequirements,
      preserveRequirements: values.preserveRequirements,
    },
  });

  // useWatch rather than watch(): it is a subscribing hook, so it stays
  // memoizable and does not opt this component out of React Compiler.
  const briefValue = useWatch({ control, name: 'brief' }) ?? '';

  return (
    <section aria-labelledby="brief-heading" className="space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Step 2</p>
        <h2 id="brief-heading" className="display-heading text-3xl sm:text-4xl">
          What would you like to happen in the video?
        </h2>
        <p className="max-w-xl leading-relaxed text-bone-400">
          Write it the way you would describe it to a director. Specifics beat adjectives.
        </p>
      </header>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
        <Field
          id="brief"
          label="Your brief"
          description={`For example: “${BRIEF_EXAMPLE}”`}
          error={errors.brief?.message}
          required
        >
          {(props) => (
            <>
              <Textarea
                {...props}
                {...register('brief')}
                rows={7}
                placeholder="Describe the scene, the action and how it should feel…"
              />
              <p className="mt-2 text-right text-xs text-bone-400/70" aria-live="polite">
                {briefValue.length} / {MAX_BRIEF_LENGTH}
              </p>
            </>
          )}
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            id="mood"
            label="Mood"
            description="Confident, serene, playful, cinematic…"
            error={errors.mood?.message}
            optionalHint
          >
            {(props) => <Input {...props} {...register('mood')} placeholder="Confident and warm" />}
          </Field>

          <Field
            id="environment"
            label="Location or environment"
            description="Where this takes place."
            error={errors.environment?.message}
            optionalHint
          >
            {(props) => (
              <Input {...props} {...register('environment')} placeholder="Monaco harbour, sunset" />
            )}
          </Field>
        </div>

        <Field
          id="wardrobeStyle"
          label="Wardrobe and styling"
          description="What you are wearing, and the overall styling."
          error={errors.wardrobeStyle?.message}
          optionalHint
        >
          {(props) => (
            <Input
              {...props}
              {...register('wardrobeStyle')}
              placeholder="Linen summer suit, minimal jewellery"
            />
          )}
        </Field>

        {/* -------------------------------------------------------- Orientation */}
        <Controller
          name="orientation"
          control={control}
          render={({ field }) => (
            <fieldset>
              <legend className="text-sm font-medium text-bone-200">Orientation</legend>
              <p className="mt-2 text-xs text-bone-400">Where will this mostly be watched?</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {PROJECT_ORIENTATIONS.map((orientation) => {
                  const meta = orientationMeta(orientation);
                  const isSelected = field.value === orientation;
                  return (
                    <label
                      key={orientation}
                      className={cn(
                        'flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-colors',
                        isSelected
                          ? 'border-brass-400/60 bg-brass-400/[0.06]'
                          : 'border-white/10 bg-white/[0.02] hover:border-white/25',
                      )}
                    >
                      <input
                        type="radio"
                        name={field.name}
                        value={orientation}
                        checked={isSelected}
                        onChange={() => field.onChange(orientation)}
                        onBlur={field.onBlur}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          'shrink-0 rounded-[3px] border-2',
                          isSelected ? 'border-brass-400' : 'border-white/25',
                          orientation === 'VERTICAL_9_16' && 'h-9 w-[1.265rem]',
                          orientation === 'LANDSCAPE_16_9' && 'h-[1.265rem] w-9',
                          orientation === 'SQUARE_1_1' && 'size-7',
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-bone-50">
                          {meta.label} {meta.ratio}
                        </span>
                        <span className="block truncate text-xs text-bone-400">{meta.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {errors.orientation?.message ? (
                <p role="alert" className="mt-2 text-xs font-medium text-rose-300">
                  {errors.orientation.message}
                </p>
              ) : null}
            </fieldset>
          )}
        />

        {/* ----------------------------------------------------------- Duration */}
        <Controller
          name="desiredDurationSeconds"
          control={control}
          render={({ field }) => (
            <fieldset>
              <legend className="text-sm font-medium text-bone-200">Approximate length</legend>
              <p className="mt-2 text-xs text-bone-400">
                A guide, not a contract. Final length is agreed in production.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {DURATION_PRESETS.map((seconds) => {
                  const isSelected = field.value === seconds;
                  return (
                    <label
                      key={seconds}
                      className={cn(
                        'inline-flex h-10 cursor-pointer items-center rounded-full border px-5 text-sm transition-colors',
                        isSelected
                          ? 'text-brass-200 border-brass-400/60 bg-brass-400/10'
                          : 'border-white/12 text-bone-400 hover:border-white/30 hover:text-bone-50',
                      )}
                    >
                      <input
                        type="radio"
                        name={field.name}
                        value={seconds}
                        checked={isSelected}
                        onChange={() => field.onChange(seconds)}
                        onBlur={field.onBlur}
                        className="sr-only"
                      />
                      {seconds} seconds
                    </label>
                  );
                })}
              </div>

              {errors.desiredDurationSeconds?.message ? (
                <p role="alert" className="mt-2 text-xs font-medium text-rose-300">
                  {errors.desiredDurationSeconds.message}
                </p>
              ) : null}
            </fieldset>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            id="specialRequirements"
            label="Special requirements"
            description="Anything the production team needs to know."
            error={errors.specialRequirements?.message}
            optionalHint
          >
            {(props) => (
              <Textarea
                {...props}
                {...register('specialRequirements')}
                rows={4}
                placeholder="Include the watch on my left wrist…"
              />
            )}
          </Field>

          <Field
            id="preserveRequirements"
            label="Things that must not be changed"
            description="Features, marks or details we must keep exactly as they are."
            error={errors.preserveRequirements?.message}
            optionalHint
          >
            {(props) => (
              <Textarea
                {...props}
                {...register('preserveRequirements')}
                rows={4}
                placeholder="Do not alter my hairline or the scar above my eyebrow…"
              />
            )}
          </Field>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" variant="accent" disabled={submitting}>
            {submitting ? <Spinner label="Saving your brief" /> : null}
            {submitting ? 'Saving…' : 'Continue to reference images'}
          </Button>
        </div>
      </form>
    </section>
  );
}
