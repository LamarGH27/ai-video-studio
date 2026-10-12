import 'server-only';
import { authoriseDeliveryAsset } from '@/lib/data/deliveries';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseEnv } from '@/lib/env';

/** Stream with the caller's JWT: Storage independently rechecks release and erasure.
 * No read token, redirect or upstream credential is returned to the browser. */
export async function downloadFinal(
  assetId: string,
  range: string | null,
  filename?: string,
): Promise<Response | null> {
  const authorised = await authoriseDeliveryAsset(assetId);
  if (!authorised || authorised.asset.asset_type !== 'FINAL_VIDEO') return null;
  const supabase = await createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) return null;
  const { url, publishableKey } = requireSupabaseEnv();
  const asset = authorised.asset;
  if (asset.storage_bucket !== 'project-deliveries') return null;
  const objectPath = asset.storage_path.split('/').map(encodeURIComponent).join('/');
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + session.access_token,
    apikey: publishableKey,
  };
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  let upstream: Response;
  try {
    upstream = await fetch(
      new URL('/storage/v1/object/authenticated/project-deliveries/' + objectPath, url),
      {
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      },
    );
  } catch {
    return null;
  }
  if (![200, 206, 416].includes(upstream.status)) {
    await upstream.body?.cancel();
    return null;
  }
  const responseHeaders = new Headers({
    'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
    'Content-Type': asset.mime_type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': filename
      ? 'attachment; filename="' + filename.replace(/[^a-zA-Z0-9._-]/g, '_') + '"'
      : 'inline',
  });
  for (const key of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
