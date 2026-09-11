'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { signInAction } from './actions';
import { idleFormState } from './form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="accent" className="w-full" disabled={pending}>
      {pending ? <Spinner label="Signing in" /> : null}
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signInAction, idleFormState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.status === 'error' && state.message ? (
        <Alert tone="error">{state.message}</Alert>
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

      <Field id="password" label="Password" error={state.fieldErrors?.password?.[0]} required>
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
