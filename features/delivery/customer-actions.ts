'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import {
  approvePreviewSchema,
  requestRevisionSchema,
  type ApprovePreviewInput,
  type RequestRevisionInput,
} from '@/lib/validation/delivery';
import { fail, ok, type ActionResult } from '@/features/create-project/action-result';

/**
 * The customer's two decisions about a preview.
 *
 * Both delegate to a database function rather than doing the work here, and
 * that is the whole point. Approving a preview means "write an approval row AND
 * move the project to FINALISING"; requesting a revision means "write a revision
 * row AND move the project to REVISION_REQUESTED". Done as two round trips from
 * here, the first could succeed and the second fail, leaving a revision against
 * a project that is not in revision — a state nothing in the UI knows how to
 * show and nothing in the workflow knows how to leave.
 *
 * One RPC call is one statement is one transaction: both halves land or neither
 * does. The functions are SECURITY DEFINER and therefore bypass RLS, which is
 * exactly why each re-derives auth.uid() and re-checks ownership and status
 * inside the database. Neither is a general status setter — each reaches one
 * status, from one status, for the owner only.
 *
 * These actions add nothing to that guarantee; they translate its errors into
 * something a customer can read.
 */

function fieldErrorsFrom(error: z.ZodError<unknown>): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

/**
 * Maps a Postgres error to a customer-facing message.
 *
 * Deliberately uniform about ownership: a project belonging to someone else and
 * a project that does not exist produce the same sentence, so this cannot be
 * used to discover whether another customer's id is real.
 */
function messageForRpcError(error: { message?: string; code?: string }): string {
  const raw = error.message ?? '';

  if (/Project not found/i.test(raw)) return 'We could not find that project.';
  if (/already an open revision/i.test(raw)) {
    return 'You already have an open revision request on this project.';
  }
  if (/awaiting your approval/i.test(raw)) {
    return 'This project is not waiting for your decision.';
  }
  if (/only be requested against a preview/i.test(raw)) {
    return 'There is no preview to request changes against right now.';
  }
  if (/no preview to approve/i.test(raw)) {
    return 'There is no preview to approve yet.';
  }
  if (/between 20 and 2000/i.test(raw)) {
    return 'Tell us a little more about what you would like changed.';
  }
  if (/Authentication required/i.test(raw)) return 'Sign in to continue.';

  return 'We could not complete that. Try again.';
}

/** Approve the latest preview. Atomically records the approval and finalises. */
export async function approvePreviewAction(
  input: ApprovePreviewInput,
): Promise<ActionResult<{ approvalId: string }>> {
  const user = await getSessionUser();
  if (!user) {
    return fail('UNAUTHENTICATED', 'Sign in to approve your preview.');
  }

  const parsed = approvePreviewSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'We could not find that project.');
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc('approve_preview', {
    p_project_id: parsed.data.projectId,
  });

  if (error || !data) {
    return fail('CONFLICT', error ? messageForRpcError(error) : 'We could not approve that.');
  }

  revalidatePath('/dashboard');
  revalidatePath(`/dashboard/projects/${parsed.data.projectId}`);
  revalidatePath('/admin');

  return ok({ approvalId: data });
}

/** Request changes to the latest preview. Atomically records and re-opens work. */
export async function requestRevisionAction(
  input: RequestRevisionInput,
): Promise<ActionResult<{ revisionId: string }>> {
  const user = await getSessionUser();
  if (!user) {
    return fail('UNAUTHENTICATED', 'Sign in to request changes.');
  }

  const parsed = requestRevisionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      'VALIDATION',
      'Tell us what you would like changed.',
      fieldErrorsFrom(parsed.error),
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc('request_project_revision', {
    p_project_id: parsed.data.projectId,
    p_message: parsed.data.message,
  });

  if (error || !data) {
    return fail(
      'CONFLICT',
      error ? messageForRpcError(error) : 'We could not record that request.',
    );
  }

  revalidatePath('/dashboard');
  revalidatePath(`/dashboard/projects/${parsed.data.projectId}`);
  revalidatePath('/admin');

  return ok({ revisionId: data });
}
