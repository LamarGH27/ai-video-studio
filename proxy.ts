import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Next.js proxy (the convention formerly called middleware).
 *
 * Refreshes the Supabase session on every matched request and gates the
 * authenticated areas of the site.
 *
 * This is a first line of defence, not the only one. Each protected page also
 * calls requireUser()/requireAdmin() server-side, and the database enforces
 * ownership through RLS regardless of what any middleware decides. Role checks
 * are deliberately NOT done here — they need a database read, so they live in
 * the route's own server-side guard.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/admin'];

export default async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  const requiresAuth = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (requiresAuth && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  // Signed-in users have no use for the auth screens.
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    dashboardUrl.search = '';
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation output. The session
     * cookie must be refreshed on normal navigations, not on every .svg request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
