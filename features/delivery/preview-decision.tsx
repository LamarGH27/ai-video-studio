'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Field } from '@/components/ui/field';
import {
  MAX_REVISION_MESSAGE_LENGTH,
  MIN_REVISION_MESSAGE_LENGTH,
} from '@/lib/validation/delivery';
import { approvePreviewAction, requestRevisionAction } from './customer-actions';

/**
 * The customer's decision on a preview.
 *
 * Rendered only for the owning customer, and only while the project is
 * PREVIEW_READY — but neither of those is what enforces it. Both actions go
 * through database functions that re-check the caller and the status, so
 * reaching this component by any other route achieves nothing.
 */
export function PreviewDecision({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'idle' | 'revision'>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const tooShort = message.trim().length < MIN_REVISION_MESSAGE_LENGTH;

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approvePreviewAction({ projectId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function requestRevision() {
    setError(null);
    setFieldError(null);

    if (tooShort) {
      setFieldError(`Tell us a little more — at least ${MIN_REVISION_MESSAGE_LENGTH} characters.`);
      return;
    }

    startTransition(async () => {
      const result = await requestRevisionAction({ projectId, message: message.trim() });
      if (!result.ok) {
        setFieldError(result.fieldErrors?.message?.[0] ?? null);
        setError(result.fieldErrors?.message?.[0] ? null : result.message);
        return;
      }
      setMessage('');
      setMode('idle');
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="preview-decision-heading"
      className="rounded-panel border border-brass-400/30 bg-brass-400/[0.04] p-6 sm:p-8"
    >
      <h2 id="preview-decision-heading" className="display-heading text-2xl">
        Your preview is ready.
      </h2>
      <p className="text-bone-300 mt-3 max-w-xl leading-relaxed">
        Watch it through, then tell us whether to finish it as it is or make changes. Nothing
        happens until you choose.
      </p>

      {error ? (
        <Alert tone="error" className="mt-6">
          {error}
        </Alert>
      ) : null}

      {mode === 'idle' ? (
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="accent" size="lg" onClick={approve} disabled={pending}>
            {pending ? <Spinner label="Approving" /> : <Check aria-hidden="true" />}
            {pending ? 'Approving…' : 'Approve Preview'}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() => {
              setError(null);
              setMode('revision');
            }}
          >
            <MessageSquare aria-hidden="true" />
            Request Revision
          </Button>
        </div>
      ) : (
        <div className="mt-7 space-y-5">
          <Field
            id="revision-message"
            label="What would you like changed?"
            description="Be as specific as you can — which moment, and what should be different. One request at a time."
            error={fieldError ?? undefined}
            required
          >
            {(props) => (
              <>
                <Textarea
                  {...props}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  maxLength={MAX_REVISION_MESSAGE_LENGTH}
                  placeholder="The walk along the deck is too fast — could it hold a beat longer at the railing? Everything else is right."
                />
                <p className="mt-2 text-right text-xs text-bone-400/70" aria-live="polite">
                  {message.trim().length} / {MAX_REVISION_MESSAGE_LENGTH}
                </p>
              </>
            )}
          </Field>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setMode('idle');
                setFieldError(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" variant="accent" onClick={requestRevision} disabled={pending}>
              {pending ? <Spinner label="Sending your request" /> : null}
              {pending ? 'Sending…' : 'Send revision request'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
