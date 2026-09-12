import { NextResponse, type NextRequest } from 'next/server';
import { authoriseDeliveryAsset, signDeliveryAsset } from '@/lib/data/deliveries';
import { sanitiseOriginalFilename } from '@/lib/storage/paths';

/**
 * Authorised access to one piece of delivery media.
 *
 * The asset id in the URL is untrusted: authoriseDeliveryAsset() re-derives the
 * caller from the session and walks the full ownership chain before anything is
 * signed. A caller who is neither the owner nor an administrator gets 404 — the
 * same response as an id that does not exist, so this cannot be used to probe
 * for other customers' assets.
 *
 * The response is a redirect to a short-lived signed URL. The bytes never pass
 * through this function, so a large video does not touch the serverless
 * request path, and `?download=1` asks Storage to set Content-Disposition.
 *
 * Nothing here may be cached: the redirect target is a credential.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;

  const authorised = await authoriseDeliveryAsset(assetId);
  if (!authorised) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const wantsDownload = request.nextUrl.searchParams.get('download') === '1';
  const kind = authorised.asset.asset_type === 'FINAL_VIDEO' ? 'final' : 'preview';
  const extension = authorised.asset.mime_type === 'video/webm' ? 'webm' : 'mp4';

  const signedUrl = await signDeliveryAsset(authorised.asset, {
    ...(wantsDownload
      ? {
          downloadAs: sanitiseOriginalFilename(
            `${authorised.project.public_reference}-${kind}-v${authorised.asset.version}.${extension}`,
          ),
        }
      : {}),
  });

  if (!signedUrl) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  return NextResponse.redirect(signedUrl, {
    status: 302,
    headers: {
      // A signed URL is a bearer credential with a short life. It must never
      // land in a shared cache, a CDN, or the browser's disk cache.
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}
