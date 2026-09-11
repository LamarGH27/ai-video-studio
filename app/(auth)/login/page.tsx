import Link from 'next/link';
import type { Metadata } from 'next';
import { Alert } from '@/components/ui/alert';
import { AuthFormShell } from '@/features/auth/auth-form-shell';
import { LoginForm } from '@/features/auth/login-form';
import { safeRedirectPath } from '@/lib/validation/auth';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'That sign-in link was incomplete. Try again.',
  auth_callback_failed: 'We could not complete that sign-in. Try again.',
  invalid_confirmation_link: 'That confirmation link is not valid.',
  expired_confirmation_link: 'That link has expired. Request a new one.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next, '/dashboard');
  const error = params.error ? ERROR_MESSAGES[params.error] : undefined;

  return (
    <AuthFormShell
      title="Sign in"
      description="Pick up a brief, or check on a project already in production."
      footer={
        <div className="flex flex-col gap-2 text-bone-400">
          <p>
            No account yet?{' '}
            <Link
              href={`/signup?next=${encodeURIComponent(next)}`}
              className="text-brass-300 underline-offset-4 hover:underline"
            >
              Create one
            </Link>
          </p>
          <p>
            <Link
              href="/forgot-password"
              className="text-brass-300 underline-offset-4 hover:underline"
            >
              Forgotten your password?
            </Link>
          </p>
        </div>
      }
    >
      {error ? (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      ) : null}
      <LoginForm next={next} />
    </AuthFormShell>
  );
}
