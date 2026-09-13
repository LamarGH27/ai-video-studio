import type { EmailProvider, SendResult, TransactionalEmail } from '../provider';
import { isRetryableStatus, summariseProviderError } from '../provider';

/**
 * Resend, over its REST API.
 *
 * Deliberately `fetch` rather than the SDK: the request is one POST with four
 * fields, and a dependency that ships its own HTTP stack into a serverless
 * bundle buys nothing here. It also keeps the provider swappable without a
 * package change.
 *
 * The API key is read at construction, from a server-only variable. It is never
 * logged, never returned in a result, and never reaches the outbox.
 */
export function createResendProvider(options: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailProvider {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'resend',

    async send(email: TransactionalEmail): Promise<SendResult> {
      let response: Response;

      try {
        response = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            // Resend deduplicates on this for 24h, so an ambiguous timeout that
            // we retry does not deliver twice.
            'Idempotency-Key': email.idempotencyKey,
          },
          body: JSON.stringify({
            from: options.from,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            text: email.text,
          }),
        });
      } catch (error) {
        // DNS failure, TLS failure, timeout — the request may or may not have
        // arrived, which is exactly what the idempotency key is for.
        return {
          ok: false,
          permanent: false,
          message: summariseProviderError(null, error instanceof Error ? error.message : ''),
        };
      }

      if (response.ok) {
        const body = await response.json().catch(() => null);
        const id =
          body && typeof body === 'object' && 'id' in body
            ? String((body as { id: unknown }).id)
            : null;
        return { ok: true, id };
      }

      const body = await response.text().catch(() => '');
      return {
        ok: false,
        permanent: !isRetryableStatus(response.status),
        message: summariseProviderError(response.status, body),
      };
    },
  };
}
