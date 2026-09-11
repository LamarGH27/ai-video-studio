import { z } from 'zod';

const email = z.email('Enter a valid email address').max(320).trim().toLowerCase();

/**
 * Password policy. Length is the control that matters; arbitrary character-class
 * rules push people towards predictable substitutions. Supabase enforces its own
 * minimum too — keep this at or above the project's Auth setting.
 */
const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(72, 'Passwords are limited to 72 characters');

export const loginSchema = z.object({
  email,
  // Not length-checked on login: a legacy password must still be able to sign in,
  // and rejecting it here would leak the policy.
  password: z.string().min(1, 'Enter your password'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, 'Enter your name')
      .max(120, 'Name is limited to 120 characters'),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const forgotPasswordSchema = z.object({ email });

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Only same-origin, path-only redirects are ever followed after auth.
 * An absolute URL or a protocol-relative `//host` would be an open redirect.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.includes('\\')) return fallback;
  return value;
}
