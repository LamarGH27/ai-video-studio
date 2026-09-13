'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { retryNotificationAction } from './notification-actions';

/**
 * Requeue one dead-lettered notification.
 *
 * Offered only for rows whose attempts are spent — a row the worker will retry
 * by itself does not need a button, and pressing one would only reset a
 * schedule that is already working.
 */
export function NotificationRetryButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await retryNotificationAction({ notificationId });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? <Spinner label="Requeueing" /> : <RotateCcw aria-hidden="true" />}
        {pending ? 'Requeueing…' : 'Retry'}
      </Button>
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
