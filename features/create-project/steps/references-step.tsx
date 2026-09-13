'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ImageUp, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { formatFileSize, cn } from '@/lib/utils';
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES_PER_PROJECT,
  MIN_REFERENCE_IMAGES_PER_PROJECT,
} from '@/lib/storage/config';
import type { UploadedAsset } from '../types';

const GOOD_GUIDANCE = [
  'A clear, unobstructed face',
  'Good, even lighting',
  'Several different angles',
  'A full-body image where the film calls for one',
  'The highest resolution you have',
] as const;

const AVOID_GUIDANCE = [
  'Blurred or motion-smeared photos',
  'Group photographs',
  'Heavy filters or beauty smoothing',
  'Sunglasses or anything obscuring the face',
] as const;

/**
 * Step 3 — reference images.
 *
 * Files never pass through this application's servers. The browser asks for a
 * one-shot signed upload slot, uploads straight to private Supabase Storage,
 * then asks the server to record what landed. See features/create-project/actions.ts.
 */
export function ReferencesStep({
  assets,
  uploading,
  uploadErrors,
  onFilesSelected,
  onRemove,
  onBack,
  onContinue,
  requiresAuth,
  authNextPath,
}: {
  assets: readonly UploadedAsset[];
  uploading: boolean;
  uploadErrors: readonly string[];
  onFilesSelected: (files: FileList) => void;
  onRemove: (assetId: string) => void;
  onBack: () => void;
  onContinue: () => void;
  requiresAuth: boolean;
  authNextPath: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const limitMb = Math.round(MAX_REFERENCE_IMAGE_BYTES / (1024 * 1024));
  const atLimit = assets.length >= MAX_REFERENCE_IMAGES_PER_PROJECT;

  if (requiresAuth) {
    return (
      <section aria-labelledby="auth-gate-heading" className="space-y-10">
        <header className="max-w-2xl space-y-4">
          <p className="eyebrow">Step 3 — Your photos</p>
          <h2 id="auth-gate-heading" className="display-heading text-display-md">
            Create an account to continue.
          </h2>
          <p className="lede">
            Your photographs are private, so they need an owner. Creating an account takes a moment.
          </p>
          <p className="text-brass-300">
            Your brief has been kept — you will come straight back to this page.
          </p>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild variant="accent" size="lg">
            <Link href={`/signup?next=${encodeURIComponent(authNextPath)}`}>Create account</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/login?next=${encodeURIComponent(authNextPath)}`}>
              I already have an account
            </Link>
          </Button>
        </div>

        <Button type="button" variant="ghost" onClick={onBack}>
          Back to your brief
        </Button>
      </section>
    );
  }

  return (
    <section aria-labelledby="references-heading" className="space-y-10">
      <header className="max-w-2xl space-y-4">
        <p className="eyebrow">Step 3 — Your photos</p>
        <h2 id="references-heading" className="display-heading text-display-md">
          Now show us who we are filming.
        </h2>
        {/* Why, before what. People send us their camera roll when nobody has
            explained that a few good frames beat forty poor ones. */}
        <p className="lede">
          These photographs are what your face, your build and your presence are built from. A few
          clear ones do more than a hundred casual ones — this is the single biggest thing you
          control about how the final film looks.
        </p>
        <p className="text-sm leading-relaxed text-bone-500">
          {MIN_REFERENCE_IMAGES_PER_PROJECT} to {MAX_REFERENCE_IMAGES_PER_PROJECT} images · JPEG,
          PNG or WebP · up to {limitMb} MB each · private to you, never published
        </p>
      </header>

      <div className="grid gap-x-12 gap-y-8 pt-8 rule-top sm:grid-cols-2">
        <div>
          <h3 className="display-heading text-lg">What works</h3>
          <ul className="mt-4 space-y-2.5">
            {GOOD_GUIDANCE.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-bone-300">
                <Check className="mt-0.5 size-4 shrink-0 text-brass-300" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="display-heading text-lg">What to avoid</h3>
          <ul className="mt-4 space-y-2.5">
            {AVOID_GUIDANCE.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-bone-500">
                <X className="mt-0.5 size-4 shrink-0 text-bone-500" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {uploadErrors.length > 0 ? (
        <Alert tone="error" title="Some images were not added">
          <ul className="list-inside list-disc space-y-1">
            {uploadErrors.map((message, index) => (
              <li key={`${message}-${index}`}>{message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/* ------------------------------------------------------------ Dropzone */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (event.dataTransfer.files.length > 0) onFilesSelected(event.dataTransfer.files);
        }}
        className={cn(
          'rounded-panel border border-dashed px-6 py-14 text-center transition-all duration-300',
          isDragging
            ? 'scale-[1.01] border-brass-400/70 bg-brass-400/[0.06]'
            : 'border-white/15 hover:border-white/30 hover:bg-white/[0.02]',
          atLimit && 'opacity-55',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mx-auto flex size-14 items-center justify-center rounded-full border transition-colors',
            isDragging
              ? 'border-brass-400/60 bg-brass-400/10 text-brass-300'
              : 'border-white/12 text-bone-500',
          )}
        >
          <ImageUp className="size-6" />
        </span>

        <p className="mt-6 display-heading text-xl">
          {atLimit
            ? 'That is the full set.'
            : isDragging
              ? 'Drop them here.'
              : 'Drag your photos here'}
        </p>
        <p className="mt-2 text-sm text-bone-500">
          {atLimit
            ? `You have reached the limit of ${MAX_REFERENCE_IMAGES_PER_PROJECT} images.`
            : 'or choose them from your device'}
        </p>

        <input
          ref={inputRef}
          id="reference-images"
          type="file"
          multiple
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          className="sr-only"
          disabled={atLimit || uploading}
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) {
              onFilesSelected(event.target.files);
            }
            // Reset so re-selecting the same file still fires a change event.
            event.target.value = '';
          }}
        />

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="mt-7"
          disabled={atLimit || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner label="Uploading" /> : null}
          {uploading ? 'Uploading…' : 'Choose images'}
        </Button>

        {/* A meter against the MINIMUM, not the maximum: what a person needs to
            know here is how many more are required before they can continue. */}
        <div className="mt-7 flex items-center justify-center gap-2" aria-hidden="true">
          {Array.from({ length: MIN_REFERENCE_IMAGES_PER_PROJECT }, (_, index) => (
            <span
              key={index}
              className={cn(
                'h-1 w-7 rounded-full transition-colors duration-500',
                index < assets.length ? 'bg-brass-400' : 'bg-white/12',
              )}
            />
          ))}
          {assets.length > MIN_REFERENCE_IMAGES_PER_PROJECT ? (
            <span className="ml-1 text-xs text-brass-300">
              +{assets.length - MIN_REFERENCE_IMAGES_PER_PROJECT}
            </span>
          ) : null}
        </div>

        <p className="mt-3 text-xs text-bone-500" aria-live="polite">
          {assets.length < MIN_REFERENCE_IMAGES_PER_PROJECT
            ? `${MIN_REFERENCE_IMAGES_PER_PROJECT - assets.length} more to go — ${assets.length} of ${MAX_REFERENCE_IMAGES_PER_PROJECT} uploaded`
            : `${assets.length} of ${MAX_REFERENCE_IMAGES_PER_PROJECT} uploaded`}
        </p>
      </div>

      {/* ---------------------------------------------------------- Uploaded */}
      {assets.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.assetId} className="group relative">
              <div className="media-frame aspect-square">
                {asset.previewUrl ? (
                  // Signed, short-lived URLs from a private bucket. next/image is
                  // deliberately not used: it would proxy and cache private media.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.previewUrl}
                    alt={`Reference image: ${asset.originalFilename}`}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-xs text-bone-400/60">
                    Preview unavailable
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onRemove(asset.assetId)}
                className="absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-full border border-white/15 bg-ink-990/90 text-bone-200 opacity-0 backdrop-blur transition-all group-focus-within:opacity-100 group-hover:opacity-100 hover:border-rose-400/50 hover:text-rose-200 focus-visible:opacity-100"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                <span className="sr-only">Remove {asset.originalFilename}</span>
              </button>

              <p className="mt-2 truncate text-xs text-bone-400" title={asset.originalFilename}>
                {asset.originalFilename}
              </p>
              <p className="text-xs text-bone-400/60">{formatFileSize(asset.fileSize)}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col-reverse gap-3 pt-8 rule-top sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          variant="accent"
          size="lg"
          onClick={onContinue}
          disabled={assets.length < MIN_REFERENCE_IMAGES_PER_PROJECT || uploading}
        >
          Continue to review
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
