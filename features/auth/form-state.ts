/** Shared shape for every `useActionState` form in the app. */
export interface FormState {
  status: 'idle' | 'error' | 'success';
  message?: string;
  /** Per-field messages keyed by the form control's name. */
  fieldErrors?: Record<string, string[]>;
}

export const idleFormState: FormState = { status: 'idle' };

export function errorState(message: string, fieldErrors?: Record<string, string[]>): FormState {
  return fieldErrors ? { status: 'error', message, fieldErrors } : { status: 'error', message };
}

export function successState(message: string): FormState {
  return { status: 'success', message };
}
