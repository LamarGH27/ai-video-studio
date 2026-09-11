'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { updatePasswordAction } from './actions';
import { idleFormState } from './form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="accent" className="w-full" disabled={pending}>
      {pending ? <Spinner label="Saving" /> : null}
      {pending ? 'Saving…' : 'Set new password'}
    </Button>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, idleFormState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.status === 'error' && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}

      <Field
        id="password"
        label="New password"
        description="At least 10 characters."
        error={state.fieldErrors?.password?.[0]}
        required
      >
        {(props) => (
          <Input {...props} name="password" type="password" autoComplete="new-password" required />
        )}
      </Field>

      <Field
        id="confirmPassword"
        label="Confirm new password"
        error={state.fieldErrors?.confirmPassword?.[0]}
        required
      >
        {(props) => (
          <Input
            {...props}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
