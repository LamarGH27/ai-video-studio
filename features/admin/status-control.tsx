'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { statusLabel } from '@/lib/projects/status';
import { updateProjectStatusAction } from './actions';
import type { ProjectStatus } from '@/types/database';

/**
 * Admin status control.
 *
 * Only renders the transitions the workflow allows from the project's current
 * status — and the server checks the same table again before writing, so a
 * crafted request gains nothing.
 */
export function StatusControl({
  projectId,
  currentStatus,
  allowed,
}: {
  projectId: string;
  currentStatus: ProjectStatus;
  allowed: readonly ProjectStatus[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (allowed.length === 0) {
    return (
      <p className="text-sm text-bone-400">
        {statusLabel(currentStatus)} is a final status. There are no further transitions.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {allowed.map((status) => (
          <Button
            key={status}
            type="button"
            variant={status === 'CANCELLED' ? 'danger' : 'outline'}
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await updateProjectStatusAction({ projectId, status });
                if (!result.ok) setError(result.message);
              });
            }}
          >
            Move to {statusLabel(status)}
          </Button>
        ))}
      </div>
    </div>
  );
}
