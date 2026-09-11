'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { requestPasswordResetAction } from './actions';
import { idleFormState } from './form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="accent" className="w-full" disabled={pending}>
      {pending ? <Spinner label="Sending" /> : null}
      {pending ? 'Sending…' : 'Send reset link'}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, idleFormState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.status === 'error' && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}
      {state.status === 'success' && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <Field id="email" label="Email" error={state.fieldErrors?.email?.[0]} required>
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
