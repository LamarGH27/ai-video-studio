import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Sign out.
 *
 * POST only. A GET would let any third-party page log the user out with an
 * <img> tag; requiring a form submission keeps it a deliberate action.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', request.nextUrl.origin), { status: 303 });
}
