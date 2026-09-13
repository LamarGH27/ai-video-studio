/**
 * The email provider boundary.
 *
 * One interface, one implementation per provider, one place that chooses. The
 * rest of the application — triggers, worker, templates, admin view — knows
 * nothing about Resend, so replacing it is a new file and a changed line in
 * providers/index.ts rather than a search across server actions.
 *
 * `send` never throws for a delivery failure. A failure is a value, because the
 * worker has to decide whether to retry it, and an exception carries no answer
 * to that question.
 */

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * The outbox dedupe key. Passed to providers that support idempotency so that
   * a send retried after an ambiguous timeout does not become two emails — the
   * database prevents duplicate rows, this prevents duplicate deliveries of one
   * row.
   */
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true; id: string | null }
  | {
      ok: false;
      /**
       * True when retrying cannot help: a rejected address, a malformed
       * request, a refused sender domain. The worker stops immediately rather
       * than spending four more attempts on the same answer.
       */
      permanent: boolean;
      /** Operator-facing, stored in last_error. Never shown to a customer. */
      message: string;
    };

export interface EmailProvider {
  readonly name: string;
  send(email: TransactionalEmail): Promise<SendResult>;
}

/**
 * Credential-shaped text, redacted before anything is stored or displayed.
 *
 * Providers echo requests back in error bodies — "Invalid API key: re_xxx" is a
 * real response shape. That string would otherwise be written to last_error,
 * which is a database column an operator reads on screen and may paste into a
 * support conversation. A key that reaches any of those places has leaked.
 *
 * Deliberately pattern-based rather than "redact the key we hold": the next
 * provider will have a different prefix, and a summariser that only knows about
 * today's credential is a summariser that fails silently on tomorrow's.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bre_[A-Za-z0-9_-]{8,}/g, // Resend
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, // Supabase
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // any JWT
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\b(?:api[_-]?key|secret|token|password)["'\s:=]+[A-Za-z0-9._-]{8,}/gi,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[redacted]'), value);
}

/**
 * Provider errors are summarised, not passed through.
 *
 * A provider's message can contain the recipient address, an internal host, a
 * stack trace or a credential. last_error is read by operators in /admin, so it
 * gets a short redacted sentence and a status code, and nothing that would be
 * awkward in a support conversation.
 */
export function summariseProviderError(status: number | null, body: unknown): string {
  const detail =
    typeof body === 'string'
      ? body
      : body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : '';

  const trimmed = redactSecrets(detail.replace(/\s+/g, ' ').trim()).slice(0, 200);
  const prefix = status === null ? 'Network error' : `Provider responded ${status}`;
  return trimmed ? `${prefix}: ${trimmed}` : prefix;
}

/**
 * Which HTTP responses are worth trying again.
 *
 * 429 and 5xx are the provider having a bad moment. 4xx otherwise is us: a bad
 * address, an unverified sender, a malformed payload — all of which will fail
 * identically in two hours.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
