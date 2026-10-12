/** Bound the entire operation, including response-body reads. Abort cooperative
 * transports; still return on time if a provider ignores cancellation. */
export async function withDeadline<T>(
  milliseconds: number,
  operation: (signal: AbortSignal) => PromiseLike<T>,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const expired = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new Error('Notification operation timed out or was cancelled'));
    };
    timer = setTimeout(onAbort, milliseconds);
    parent?.addEventListener('abort', onAbort, { once: true });
    if (parent?.aborted) onAbort();
  });
  try {
    return await Promise.race([
      expired,
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return operation(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) parent?.removeEventListener('abort', onAbort);
  }
}

export const PROVIDER_TIMEOUT_MS = 10_000;
export const DATABASE_TIMEOUT_MS = 5_000;
export const WORKER_BUDGET_MS = 50_000;
