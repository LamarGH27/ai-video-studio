import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isSupabaseConfigured, requireSupabaseEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Refreshes the Supabase auth session and returns both the (possibly
 * cookie-updated) response and the authenticated user.
 *
 * This must run on every matched request: Server Components cannot write
 * cookies, so token refresh has to happen here or sessions silently expire.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: { id: string; email: string | null } | null;
}> {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) {
    return { response, user: null };
  }

  const { url, publishableKey } = requireSupabaseEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the token with the Auth server. Do not swap this for
  // getSession(), which trusts the cookie contents without verification.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    response,
    user: user ? { id: user.id, email: user.email ?? null } : null,
  };
}
