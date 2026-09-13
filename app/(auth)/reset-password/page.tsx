import type { Metadata } from 'next';
import { AuthFormShell } from '@/features/auth/auth-form-shell';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
};

/**
 * Reached from the emailed recovery link, which passes through /auth/confirm and
 * establishes a recovery session first. Landing here without that session simply
 * fails on submit — there is nothing to leak either way.
 */
export default function ResetPasswordPage() {
  return (
    <AuthFormShell
      title="Set a new password"
      description="Choose a new password for your account."
      reassurance="Once this is set you will be signed in, and any other sessions will need the new password."
    >
      <ResetPasswordForm />
    </AuthFormShell>
  );
}
