'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { createClient } from '@/lib/supabase/client';
import {
  DELIVERY_ACCEPT_ATTRIBUTE,
  MAX_DELIVERY_VIDEO_MB,
  PROJECT_DELIVERIES_BUCKET,
  type DeliveryAssetType,
} from '@/lib/storage/config';
import { validateDeliveryCandidate } from '@/lib/validation/delivery';
import { confirmDeliveryUploadAction, requestDeliveryUploadSlotAction } from './admin-actions';

/**
 * Administrator upload of a preview or final cut.
 *
 * Identical shape to the customer's reference-image uploader, and for the same
 * reason: the server validates and names, the browser sends the bytes straight
 * to private Supabase Storage, and the server then verifies what actually
 * landed. A video is far larger than a serverless function may accept as a
 * request body, so routing it through the application is not an option — and it
 * is not needed, because the client never chooses the destination.
 */
export function DeliveryUploader({
  projectId,
  assetType,
  label,
  hint,
}: {
  projectId: string;
  assetType: DeliveryAssetType;
  label: string;
  hint: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    const candidate = validateDeliveryCandidate(file);
    if (!candidate.ok) {
      setError(candidate.message);
      return;
    }

    setBusy(true);
    try {
      setProgress('Authorising…');
      const slot = await requestDeliveryUploadSlotAction({
        projectId,
        assetType,
        mimeType: file.type as 'video/mp4' | 'video/webm',
        fileSize: file.size,
        originalFilename: file.name,
      });

      if (!slot.ok) {
        setError(slot.message);
        return;
      }

      setProgress('Uploading…');
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(PROJECT_DELIVERIES_BUCKET)
        .uploadToSignedUrl(slot.data.path, slot.data.token, file, { contentType: file.type });

      if (uploadError) {
        setError('The upload did not complete. Try again.');
        return;
      }

      setProgress('Verifying…');
      const confirmed = await confirmDeliveryUploadAction({
        projectId,
        assetType,
        storagePath: slot.data.path,
        originalFilename: file.name,
      });

      if (!confirmed.ok) {
        setError(confirmed.message);
        return;
      }

      setProgress(null);
      router.refresh();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const inputId = `delivery-upload-${assetType.toLowerCase()}`;

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={DELIVERY_ACCEPT_ATTRIBUTE}
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset first so selecting the same file again still fires a change.
          event.target.value = '';
          if (file) void upload(file);
        }}
      />

      <Button
        type="button"
        variant="accent"
        size="lg"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Spinner label={progress ?? 'Uploading'} /> : <UploadCloud aria-hidden="true" />}
        {busy ? (progress ?? 'Uploading…') : label}
      </Button>

      <p className="text-xs leading-relaxed text-bone-400" aria-live="polite">
        {hint} MP4 or WebM, up to {MAX_DELIVERY_VIDEO_MB} MB.
      </p>
    </div>
  );
}
