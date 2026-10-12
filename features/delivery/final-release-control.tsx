'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { releaseFinalVideoAction } from './admin-actions';
export function FinalReleaseControl({
  projectId,
  asset,
}: {
  projectId: string;
  asset: { id: string; version: number };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Review Final {asset.version} before releasing it. Release completes the project and notifies
        the customer.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await releaseFinalVideoAction({ projectId, assetId: asset.id });
            if (!result.ok) setError(result.message);
          });
        }}
      >
        Release Final {asset.version}
      </Button>
    </div>
  );
}
