import 'server-only';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ProfileRow } from '@/types/database';

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user, verified against the Auth server.
 *
 * Always `getUser()`, never `getSession()`: the latter returns whatever is in
 * the cookie without checking that the JWT is genuine or unexpired.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Without credentials there is no session to verify. Returning null keeps the
  // public pages rendering instead of throwing on a misconfigured deployment.
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return { id: user.id, email: user.email ?? null };
}

export async function getProfile(): Promise<ProfileRow | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return null;
  return data;
}

/** Redirects unauthenticated callers to /login, preserving where they were heading. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/login${next}`);
  }
  return user;
}

/**
 * Server-side admin gate.
 *
 * The role is read from the database, not from a cookie, a header or the JWT —
 * and profiles.role is protected by an RLS policy plus a database trigger, so a
 * customer cannot grant it to themselves. Hiding the nav link is presentation;
 * this is the access control.
 */
export async function requireAdmin(): Promise<{ user: SessionUser; profile: ProfileRow }> {
  const user = await requireUser('/admin');
  const profile = await getProfile();

  if (!profile || profile.role !== 'admin') {
    // Deliberately a redirect rather than a 403: a non-admin has no business
    // learning that /admin resolves to anything.
    redirect('/dashboard');
  }

  return { user, profile };
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const profile = await getProfile();
  return profile?.role === 'admin';
}
