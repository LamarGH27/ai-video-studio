'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { CONSENT_DEFINITIONS } from '@/lib/consent/definitions';
import { orientationLabel } from '@/lib/projects/status';
import { categoryLabel } from '@/lib/catalog/categories';
import type { ExperienceOption } from '@/lib/catalog/experiences';
import type { DraftValues, UploadedAsset } from '../types';

export interface ConsentValues {
  hasLikenessPermission: boolean;
  aiProcessingConsent: boolean;
  portfolioPermission: boolean;
}

/**
 * Step 4 — review the brief, give consent, submit.
 *
 * The two required consents block submission client-side and are `z.literal(true)`
 * server-side, so an unticked box cannot slip through either way. Portfolio
 * permission starts false and is never pre-selected.
 */
export function ReviewStep({
  values,
  experience,
  assets,
  publicReference,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  values: DraftValues;
  experience: ExperienceOption | null;
  assets: readonly UploadedAsset[];
  publicReference: string | null;
  onBack: () => void;
  onSubmit: (consent: ConsentValues) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [consent, setConsent] = useState<ConsentValues>({
    hasLikenessPermission: false,
    aiProcessingConsent: false,
    portfolioPermission: false,
  });
  const [showConsentError, setShowConsentError] = useState(false);

  const requiredGiven = consent.hasLikenessPermission && consent.aiProcessingConsent;

  const summary: { label: string; value: string }[] = [
    {
      label: 'Experience',
      value: experience ? `${experience.name} · ${categoryLabel(experience.category)}` : '—',
    },
    { label: 'Mood', value: values.mood || '—' },
    { label: 'Location', value: values.environment || '—' },
    { label: 'Wardrobe and styling', value: values.wardrobeStyle || '—' },
    {
      label: 'Orientation',
      value: values.orientation ? orientationLabel(values.orientation) : '—',
    },
    { label: 'Approximate length', value: `${values.desiredDurationSeconds} seconds` },
    { label: 'Reference images', value: `${assets.length} uploaded` },
    { label: 'Special requirements', value: values.specialRequirements || 'None given' },
    { label: 'Must not be changed', value: values.preserveRequirements || 'None given' },
  ];

  return (
    <section aria-labelledby="review-heading" className="space-y-10">
      <header className="max-w-2xl space-y-4">
        <p className="eyebrow">Step 4 — Review</p>
        <h2 id="review-heading" className="display-heading text-display-md">
          Check it over, then send it to production.
        </h2>
        {publicReference ? (
          <p className="text-sm text-bone-400">
            Your project reference is{' '}
            <span className="text-bone-100 font-mono">{publicReference}</span>.
          </p>
        ) : null}
      </header>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* --------------------------------------------------------- The brief */}
      <div className="rounded-panel border border-white/10 bg-white/[0.02] p-6 sm:p-8">
        <h3 className="text-sm font-medium tracking-wide text-bone-400 uppercase">Your brief</h3>
        <p className="text-bone-100 mt-4 leading-relaxed whitespace-pre-wrap">{values.brief}</p>
      </div>

      <dl className="grid gap-px overflow-hidden rounded-panel border border-white/10 bg-white/8 sm:grid-cols-2">
        {summary.map((item) => (
          <div key={item.label} className="bg-ink-950 p-5">
            <dt className="text-xs tracking-wide text-bone-400 uppercase">{item.label}</dt>
            <dd className="text-bone-100 mt-2 text-sm leading-relaxed break-words">{item.value}</dd>
          </div>
        ))}
      </dl>

      {/* ---------------------------------------------------------- Thumbnails */}
      {assets.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium tracking-wide text-bone-400 uppercase">
            Reference images
          </h3>
          <ul className="mt-4 flex flex-wrap gap-3">
            {assets.map((asset) => (
              <li
                key={asset.assetId}
                className="size-20 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]"
              >
                {asset.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.previewUrl}
                    alt={`Reference image: ${asset.originalFilename}`}
                    className="size-full object-cover"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ Consent */}
      <fieldset className="rounded-panel border border-white/10 bg-white/[0.02] p-6 sm:p-8">
        <legend className="sr-only">Consent</legend>
        <h3 className="display-heading text-xl">Before we begin</h3>
        <p className="mt-2 text-sm leading-relaxed text-bone-400">
          This service is for consenting adults only.
        </p>

        <div className="mt-6 space-y-5">
          {CONSENT_DEFINITIONS.map((definition) => {
            const key =
              definition.field === 'has_likeness_permission'
                ? 'hasLikenessPermission'
                : definition.field === 'ai_processing_consent'
                  ? 'aiProcessingConsent'
                  : 'portfolioPermission';

            const checked = consent[key];
            const inputId = `consent-${definition.field}`;
            const describedBy = definition.helpText ? `${inputId}-help` : undefined;

            return (
              <div key={definition.type} className="flex gap-3.5">
                <Checkbox
                  id={inputId}
                  checked={checked}
                  aria-describedby={describedBy}
                  aria-invalid={
                    showConsentError && definition.required && !checked ? true : undefined
                  }
                  onCheckedChange={(value) => {
                    setConsent((previous) => ({ ...previous, [key]: value === true }));
                    setShowConsentError(false);
                  }}
                />

                <div className="space-y-1.5">
                  <label htmlFor={inputId} className="text-bone-100 block text-sm leading-relaxed">
                    {definition.statement}
                    {definition.required ? (
                      <span className="ml-1 text-brass-300" aria-hidden="true">
                        *
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-bone-400/70">Optional</span>
                    )}
                  </label>
                  {definition.helpText ? (
                    <p id={describedBy} className="text-xs text-bone-400">
                      {definition.helpText}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {showConsentError && !requiredGiven ? (
          <p role="alert" className="mt-5 text-xs font-medium text-rose-300">
            Both required confirmations must be ticked before you can submit.
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button
          type="button"
          variant="accent"
          size="lg"
          disabled={submitting}
          onClick={() => {
            if (!requiredGiven) {
              setShowConsentError(true);
              return;
            }
            onSubmit(consent);
          }}
        >
          {submitting ? <Spinner label="Submitting your project" /> : null}
          {submitting ? 'Submitting…' : 'Submit Project'}
        </Button>
      </div>
    </section>
  );
}
