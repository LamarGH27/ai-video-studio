import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/validation/auth';

/**
 * PKCE code exchange.
 *
 * Supabase redirects here with `?code=...` after a flow that issues an
 * authorisation code. Exchanging it sets the session cookies on the response.
 *
 * `next` is passed through safeRedirectPath so a crafted link cannot turn this
 * route into an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeRedirectPath(searchParams.get('next'), '/dashboard');

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
