import { describe, expect, it } from 'vitest';
import { loginSchema, safeRedirectPath, signupSchema } from '@/lib/validation/auth';

describe('safeRedirectPath', () => {
  it('allows same-origin paths', () => {
    expect(safeRedirectPath('/dashboard')).toBe('/dashboard');
    expect(safeRedirectPath('/create?experience=fashion')).toBe('/create?experience=fashion');
  });

  it('falls back when no destination is given', () => {
    expect(safeRedirectPath(null)).toBe('/dashboard');
    expect(safeRedirectPath(undefined)).toBe('/dashboard');
    expect(safeRedirectPath('')).toBe('/dashboard');
    expect(safeRedirectPath(null, '/')).toBe('/');
  });

  // The `next` parameter reaches us from an attacker-controllable link, so every
  // form of off-site destination has to be refused.
  it('refuses anything that could leave the site', () => {
    expect(safeRedirectPath('https://evil.example/phish')).toBe('/dashboard');
    expect(safeRedirectPath('//evil.example/phish')).toBe('/dashboard');
    expect(safeRedirectPath('/\\evil.example')).toBe('/dashboard');
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/dashboard');
    expect(safeRedirectPath('dashboard')).toBe('/dashboard');
  });
});

describe('signupSchema', () => {
  const valid = {
    displayName: 'Alex Moreau',
    email: 'Alex@Example.COM',
    password: 'a-long-enough-password',
    confirmPassword: 'a-long-enough-password',
  };

  it('normalises the email address', () => {
    const result = signupSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('alex@example.com');
  });

  it('rejects a password shorter than the policy', () => {
    const result = signupSchema.safeParse({
      ...valid,
      password: 'short',
      confirmPassword: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('reports a mismatch against the confirmation field', () => {
    const result = signupSchema.safeParse({ ...valid, confirmPassword: 'something-else-here' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'confirmPassword')).toBe(true);
    }
  });

  it('rejects an invalid email address', () => {
    expect(signupSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  // Applying the length policy on sign-in would reject legacy passwords and
  // leak the current policy to anyone probing the form.
  it('does not impose the password policy on sign-in', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
  });

  it('still requires a password to be present', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
