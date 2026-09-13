import 'server-only';

import { emailEnv } from '@/lib/notifications/config';
import type { EmailProvider } from '../provider';
import { createConsoleProvider } from './console';
import { createResendProvider } from './resend';

/**
 * Chooses the provider, and refuses to guess.
 *
 * Configured  -> Resend.
 * Unconfigured in development -> the console provider, which says loudly that
 *   nothing was delivered.
 * Unconfigured anywhere else -> an error. The worker records it as a failure
 *   and the admin view shows it.
 *
 * The one outcome that is not on offer is silently pretending: a deployment
 * that marks every notification SENT while sending nothing is worse than one
 * that is visibly broken, because nobody goes looking for it.
 */
export function resolveEmailProvider(): EmailProvider {
  const config = emailEnv();

  if (config.resendApiKey && config.emailFrom) {
    return createResendProvider({ apiKey: config.resendApiKey, from: config.emailFrom });
  }

  if (process.env.NODE_ENV === 'development') {
    return createConsoleProvider();
  }

  throw new Error(
    'Email is not configured. Set RESEND_API_KEY and EMAIL_FROM (see docs/notifications.md).',
  );
}
