import type { EmailProvider, SendResult, TransactionalEmail } from '../provider';

/**
 * Development provider. Prints what would have been sent and reports success.
 *
 * It announces itself on every send, and resolveEmailProvider() refuses to
 * select it outside development, because the failure this guards against is a
 * production deployment quietly marking everything SENT while no customer ever
 * receives anything.
 *
 * The body is not printed. A development log is still a log, and these messages
 * carry a customer's address and project.
 */
export function createConsoleProvider(sink: Pick<Console, 'info'> = console): EmailProvider {
  return {
    name: 'console',

    async send(email: TransactionalEmail): Promise<SendResult> {
      sink.info(
        `[notifications] NOT SENT — no email provider configured. ` +
          `Would send "${email.subject}" to ${email.to} (${email.idempotencyKey}).`,
      );
      return { ok: true, id: null };
    },
  };
}
