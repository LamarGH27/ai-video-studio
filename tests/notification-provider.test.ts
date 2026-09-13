import { describe, expect, it, vi } from 'vitest';
import {
  isRetryableStatus,
  redactSecrets,
  summariseProviderError,
} from '@/lib/notifications/provider';
import { createResendProvider } from '@/lib/notifications/providers/resend';
import { createConsoleProvider } from '@/lib/notifications/providers/console';

const EMAIL = {
  to: 'someone@example.com',
  subject: 'Your preview is ready — AVS-000123',
  html: '<p>hello</p>',
  text: 'hello',
  idempotencyKey: 'project:abc:preview:def:ready',
};

function providerWith(response: Partial<Response> & { jsonBody?: unknown; textBody?: string }) {
  const fetchImpl = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      ({
        ok: response.ok ?? false,
        status: response.status ?? 500,
        json: async () => response.jsonBody ?? {},
        text: async () => response.textBody ?? '',
      }) as unknown as Response,
  );
  return {
    fetchImpl,
    provider: createResendProvider({ apiKey: 're_test_key', from: 'x@y.z', fetchImpl }),
  };
}

describe('classifying provider failures', () => {
  /**
   * The distinction that matters: retrying a 503 may work, retrying a rejected
   * address never will. Getting it wrong in one direction loses mail; in the
   * other it spends the whole retry budget re-asking a question already
   * answered, and hammers the provider while doing it.
   */
  it('retries the provider having a bad moment', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status), `${status} should be retryable`).toBe(true);
    }
  });

  it('does not retry what will fail identically next time', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isRetryableStatus(status), `${status} should be permanent`).toBe(false);
    }
  });
});

describe('error summaries', () => {
  it('names the status and keeps the provider’s explanation short', () => {
    expect(summariseProviderError(422, { message: 'Invalid `to` field' })).toBe(
      'Provider responded 422: Invalid `to` field',
    );
    expect(summariseProviderError(503, '')).toBe('Provider responded 503');
    expect(summariseProviderError(null, 'getaddrinfo ENOTFOUND')).toBe(
      'Network error: getaddrinfo ENOTFOUND',
    );
  });

  /**
   * last_error is read by operators in /admin, and a stack trace pasted into a
   * support conversation is how internal hostnames escape.
   */
  it('truncates, and collapses multi-line detail to one line', () => {
    const summary = summariseProviderError(
      500,
      `line one\n  at internal.host:443\n${'x'.repeat(500)}`,
    );
    expect(summary).not.toContain('\n');
    expect(summary.length).toBeLessThanOrEqual(230);
  });

  it('says something useful even when the body is unreadable', () => {
    expect(summariseProviderError(500, null)).toBe('Provider responded 500');
    expect(summariseProviderError(500, { unexpected: true })).toBe('Provider responded 500');
  });
});

describe('the Resend provider', () => {
  it('sends the message and returns the provider id', async () => {
    const { provider, fetchImpl } = providerWith({
      ok: true,
      status: 200,
      jsonBody: { id: 'msg_1' },
    });
    const result = await provider.send(EMAIL);

    expect(result).toEqual({ ok: true, id: 'msg_1' });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ to: ['someone@example.com'], subject: EMAIL.subject });
    // Both parts, always.
    expect(body.html).toBe(EMAIL.html);
    expect(body.text).toBe(EMAIL.text);
  });

  /**
   * A timeout leaves us not knowing whether the message was delivered. The
   * database stops a second ROW; this is what stops a second DELIVERY of the
   * same row when we retry it.
   */
  it('sends the dedupe key as the idempotency key', async () => {
    const { provider, fetchImpl } = providerWith({ ok: true, status: 200, jsonBody: { id: 'x' } });
    await provider.send(EMAIL);

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(EMAIL.idempotencyKey);
  });

  it('reports a rejected request as permanent', async () => {
    const { provider } = providerWith({ status: 422, textBody: '{"message":"Invalid to field"}' });
    const result = await provider.send(EMAIL);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ permanent: true });
  });

  it('reports rate limiting and outages as retryable', async () => {
    for (const status of [429, 503]) {
      const { provider } = providerWith({ status, textBody: 'slow down' });
      const result = await provider.send(EMAIL);
      expect(result).toMatchObject({ ok: false, permanent: false });
    }
  });

  it('treats a network failure as retryable rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const provider = createResendProvider({ apiKey: 'k', from: 'x@y.z', fetchImpl });

    const result = await provider.send(EMAIL);
    expect(result).toMatchObject({ ok: false, permanent: false });
    expect((result as { message: string }).message).toContain('Network error');
  });

  /**
   * A credential in an error message ends up in last_error, which is a database
   * column an operator reads on screen. Providers do echo requests back.
   */
  it('never puts the API key in a result', async () => {
    const { provider } = providerWith({
      status: 401,
      textBody: 'Invalid API key: re_test_key_abcdefgh',
    });
    const result = await provider.send(EMAIL);
    expect(JSON.stringify(result)).not.toContain('re_test_key_abcdefgh');
    expect(JSON.stringify(result)).toContain('redacted');
  });

  it('succeeds even when the provider returns no id', async () => {
    const { provider } = providerWith({ ok: true, status: 200, jsonBody: {} });
    expect(await provider.send(EMAIL)).toEqual({ ok: true, id: null });
  });
});

describe('the development provider', () => {
  it('says plainly that nothing was delivered', async () => {
    const info = vi.fn();
    const result = await createConsoleProvider({ info }).send(EMAIL);

    expect(result).toEqual({ ok: true, id: null });
    const logged = String(info.mock.calls[0]![0]);
    expect(logged).toContain('NOT SENT');
    expect(logged).toContain(EMAIL.to);
    // The body is not a development convenience worth logging: it is a
    // customer's project details, and a log is still a record.
    expect(logged).not.toContain(EMAIL.html);
    expect(logged).not.toContain(EMAIL.text);
  });
});

describe('redaction', () => {
  it('removes credential-shaped text, whoever issued it', () => {
    expect(redactSecrets('key re_abcdefghijklmnop failed')).toBe('key [redacted] failed');
    expect(redactSecrets('sb_secret_abcdefghijkl')).toBe('[redacted]');
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop')).toContain('[redacted]');
    expect(redactSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefg')).toBe('[redacted]');
    expect(redactSecrets('api_key=supersecretvalue')).toBe('[redacted]');
  });

  it('leaves ordinary operational detail alone', () => {
    expect(redactSecrets('Invalid `to` field: not a valid address')).toBe(
      'Invalid `to` field: not a valid address',
    );
    expect(redactSecrets('Provider responded 503')).toBe('Provider responded 503');
  });
});
