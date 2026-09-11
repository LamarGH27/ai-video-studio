'use client';

import { useEffect } from 'react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';

/**
 * Root error boundary.
 *
 * Shows a generic message. The underlying error may reference internal state or
 * infrastructure and is not surfaced to the visitor; `digest` is enough to find
 * the real stack trace in the server logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center surface-glow">
      <Container className="py-24 text-center">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-6 display-heading text-[clamp(1.875rem,5vw,3rem)]">That did not work.</h1>
        <p className="mx-auto mt-5 max-w-md leading-relaxed text-bone-400">
          Try again. If it keeps happening, get in touch and quote this reference:{' '}
          <span className="font-mono text-bone-200">{error.digest ?? 'unknown'}</span>.
        </p>
        <Button variant="accent" className="mt-10" onClick={reset}>
          Try again
        </Button>
      </Container>
    </div>
  );
}
