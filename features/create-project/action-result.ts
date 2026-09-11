export type ActionErrorCode =
  'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT' | 'ERROR';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionErrorCode;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = undefined>(
  code: ActionErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return fieldErrors ? { ok: false, code, message, fieldErrors } : { ok: false, code, message };
}
