import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthFormShell } from '@/features/auth/auth-form-shell';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';

export const metadata: Metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthFormShell
      title="Reset your password"
      description="Enter the address you signed up with and we will email you a reset link."
      footer={
        <p className="text-bone-400">
          <Link href="/login" className="text-brass-300 underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthFormShell>
  );
}
