import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthFormShell } from '@/features/auth/auth-form-shell';
import { SignupForm } from '@/features/auth/signup-form';
import { safeRedirectPath } from '@/lib/validation/auth';

export const metadata: Metadata = {
  title: 'Create account',
  robots: { index: false, follow: false },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next, '/dashboard');

  return (
    <AuthFormShell
      title="Create your account"
      description="You need an account to upload reference images and track your project."
      footer={
        <p className="text-bone-400">
          Already have an account?{' '}
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="text-brass-300 underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <SignupForm next={next} />
    </AuthFormShell>
  );
}
