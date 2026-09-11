'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { signUpAction } from './actions';
import { idleFormState } from './form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="accent" className="w-full" disabled={pending}>
      {pending ? <Spinner label="Creating account" /> : null}
      {pending ? 'Creating account…' : 'Create account'}
    </Button>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signUpAction, idleFormState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.status === 'error' && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}
      {state.status === 'success' && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <Field
        id="displayName"
        label="Your name"
        error={state.fieldErrors?.displayName?.[0]}
        required
      >
        {(props) => (
          <Input
            {...props}
            name="displayName"
            autoComplete="name"
            required
            placeholder="Alex Moreau"
          />
        )}
      </Field>

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

      <Field
        id="password"
        label="Password"
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
        label="Confirm password"
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
