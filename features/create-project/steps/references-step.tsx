'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ImageUp, Trash2, X } from 'lucide-react';
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
      <section aria-labelledby="auth-gate-heading" className="space-y-8">
        <header className="space-y-3">
          <p className="eyebrow">Step 3</p>
          <h2 id="auth-gate-heading" className="display-heading text-3xl sm:text-4xl">
            Create an account to continue.
          </h2>
          <p className="max-w-xl leading-relaxed text-bone-400">
            Reference images are private to you, so we need an account to store them against. Your
            brief has been kept — you will come straight back here.
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
    <section aria-labelledby="references-heading" className="space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Step 3</p>
        <h2 id="references-heading" className="display-heading text-3xl sm:text-4xl">
          Upload your reference images.
        </h2>
        <p className="max-w-xl leading-relaxed text-bone-400">
          Between {MIN_REFERENCE_IMAGES_PER_PROJECT} and {MAX_REFERENCE_IMAGES_PER_PROJECT} images,
          JPEG, PNG or WebP, up to {limitMb} MB each. They are stored privately and are never
          published.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.03] p-5">
          <h3 className="text-sm font-medium text-emerald-200">What works</h3>
          <ul className="text-bone-300 mt-3 space-y-2 text-sm">
            {GOOD_GUIDANCE.map((item) => (
              <li key={item} className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.03] p-5">
          <h3 className="text-sm font-medium text-rose-200">What to avoid</h3>
          <ul className="text-bone-300 mt-3 space-y-2 text-sm">
            {AVOID_GUIDANCE.map((item) => (
              <li key={item} className="flex gap-2.5">
                <X className="mt-0.5 size-4 shrink-0 text-rose-300" aria-hidden="true" />
                <span className="leading-relaxed">{item}</span>
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
          'rounded-panel border border-dashed p-10 text-center transition-colors',
          isDragging ? 'border-brass-400/70 bg-brass-400/[0.05]' : 'border-white/15',
          atLimit && 'opacity-60',
        )}
      >
        <ImageUp className="mx-auto size-7 text-bone-400/60" aria-hidden="true" />

        <p className="text-bone-300 mt-4 text-sm">
          {atLimit
            ? `You have reached the limit of ${MAX_REFERENCE_IMAGES_PER_PROJECT} images.`
            : 'Drag images here, or choose them from your device.'}
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
          className="mt-5"
          disabled={atLimit || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner label="Uploading" /> : null}
          {uploading ? 'Uploading…' : 'Choose images'}
        </Button>

        <p className="mt-4 text-xs text-bone-400/70" aria-live="polite">
          {assets.length} of {MAX_REFERENCE_IMAGES_PER_PROJECT} uploaded
        </p>
      </div>

      {/* ---------------------------------------------------------- Uploaded */}
      {assets.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.assetId} className="group relative">
              <div className="aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
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
                className="absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-full bg-ink-950/85 text-bone-200 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
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

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          variant="accent"
          onClick={onContinue}
          disabled={assets.length < MIN_REFERENCE_IMAGES_PER_PROJECT || uploading}
        >
          Continue to review
        </Button>
      </div>
    </section>
  );
}
