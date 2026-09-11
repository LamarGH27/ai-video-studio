import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/validation/auth';

const ALLOWED_TYPES: readonly EmailOtpType[] = ['signup', 'recovery', 'email_change', 'email'];

/**
 * Email link confirmation (signup, password recovery, email change).
 *
 * This is the current Supabase SSR pattern: the emailed link carries a
 * `token_hash` and a `type`, which are verified here and exchanged for session
 * cookies. The token is consumed server-side so it never lands in client
 * JavaScript or browser history via a fragment.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeRedirectPath(searchParams.get('next'), '/dashboard');

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type as EmailOtpType)) {
    return NextResponse.redirect(new URL('/login?error=invalid_confirmation_link', origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });

  if (error) {
    return NextResponse.redirect(new URL('/login?error=expired_confirmation_link', origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
