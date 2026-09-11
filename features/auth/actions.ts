'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, siteUrl } from '@/lib/env';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  safeRedirectPath,
  signupSchema,
} from '@/lib/validation/auth';
import { errorState, successState, type FormState } from './form-state';

/**
 * Auth server actions.
 *
 * Every action re-validates its raw FormData with the same Zod schema the client
 * uses. Error messages are deliberately non-specific about whether an account
 * exists — "check your email" and "email or password is incorrect" are the same
 * response whether or not the address is registered.
 */

function fieldErrorsFrom(error: z.ZodError<unknown>): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

/**
 * A deployment without Supabase credentials should say so, not throw into the
 * error boundary. This is an operator mistake, not a customer one.
 */
const NOT_CONFIGURED = 'This environment is not connected to Supabase yet. See .env.example.';

function configurationError(): FormState | null {
  return isSupabaseConfigured() ? null : errorState(NOT_CONFIGURED);
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const notConfigured = configurationError();
  if (notConfigured) return notConfigured;

  const parsed = signupSchema.safeParse({
    displayName: formData.get('displayName'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return errorState('Check the highlighted fields.', fieldErrorsFrom(parsed.error));
  }

  const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // display_name is copied into public.profiles by the on_auth_user_created
      // trigger. It is user-supplied metadata and carries no privilege.
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return errorState(error.message);
  }

  // With email confirmation enabled there is no session yet; with it disabled
  // Supabase returns one immediately. Checking rather than assuming keeps both
  // project configurations working.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect(next);

  return successState('Check your email to confirm your account, then sign in.');
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const notConfigured = configurationError();
  if (notConfigured) return notConfigured;

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return errorState('Check the highlighted fields.', fieldErrorsFrom(parsed.error));
  }

  const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return errorState('That email or password is incorrect.');
  }

  redirect(next);
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const notConfigured = configurationError();
  if (notConfigured) return notConfigured;

  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    return errorState('Check the highlighted fields.', fieldErrorsFrom(parsed.error));
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent('/reset-password')}`,
  });

  // Always the same response, whether or not the address is registered.
  return successState('If that address has an account, a reset link is on its way.');
}

export async function updatePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const notConfigured = configurationError();
  if (notConfigured) return notConfigured;

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return errorState('Check the highlighted fields.', fieldErrorsFrom(parsed.error));
  }

  const supabase = await createClient();

  // updateUser acts on the recovery session established by the emailed link.
  // Without that session there is nothing to update, which is the desired
  // outcome for anyone who reaches this page directly.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return errorState('That reset link has expired. Request a new one.');
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return errorState(error.message);
  }

  redirect('/dashboard');
}
