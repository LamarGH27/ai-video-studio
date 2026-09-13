import 'server-only';

/**
 * Server-only configuration for notifications.
 *
 * None of these is a NEXT_PUBLIC_ variable and none may become one: they are an
 * email-sending credential, an operations address, a queue-runner secret and a
 * database key. `server-only` makes importing this file from a client component
 * a build error rather than a review question.
 *
 * Read lazily, per call, rather than captured at module load: a serverless
 * instance can outlive an environment change, and a missing variable should
 * produce a clear message at the point of use rather than a crash at import.
 */

export interface EmailConfig {
  resendApiKey: string | null;
  emailFrom: string | null;
  adminNotificationEmail: string | null;
}

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function emailEnv(): EmailConfig {
  return {
    resendApiKey: clean(process.env.RESEND_API_KEY),
    emailFrom: clean(process.env.EMAIL_FROM),
    adminNotificationEmail: clean(process.env.ADMIN_NOTIFICATION_EMAIL),
  };
}

/**
 * Where administrator notifications go.
 *
 * Resolved at SEND time, not at enqueue time, which is why an ADMIN outbox row
 * carries no address. Changing who gets operational mail is then an environment
 * change, and adding a second recipient later is a change to this function —
 * neither needs a migration or a backfill of queued rows.
 */
export function adminNotificationRecipients(): string[] {
  const configured = emailEnv().adminNotificationEmail;
  if (!configured) return [];
  return configured
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
}

/** The queue runner's shared secret. Server-only; never sent to a browser. */
export function cronSecret(): string | null {
  return clean(process.env.CRON_SECRET);
}

/**
 * The Supabase credential the queue runner uses.
 *
 * Every other Supabase client in this application acts as a signed-in user and
 * is subject to RLS. The worker has no user: it is woken by a scheduler, and
 * the rows it processes belong to nobody in particular. There is no session to
 * borrow, so it needs a credential of its own.
 *
 * Contained deliberately: this is the only reader of the variable, its only
 * consumer is lib/supabase/worker.ts, and that module's only consumer is the
 * processor route, which rejects any request without CRON_SECRET before the
 * client is constructed.
 */
export function supabaseSecretKey(): string | null {
  return clean(process.env.SUPABASE_SECRET_KEY);
}
