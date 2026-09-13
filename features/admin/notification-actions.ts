'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { fail, ok, type ActionResult } from '@/features/create-project/action-result';

const retrySchema = z.object({ notificationId: z.uuid() });

/**
 * Give a failed notification a fresh attempt budget.
 *
 * It calls retry_notification(), which UPDATES the existing row — it does not
 * insert. That matters: the dedupe key is what guarantees one email per
 * business event, and a retry that created a second row would quietly discard
 * that guarantee at exactly the moment an operator is trying to fix something.
 *
 * The database re-checks is_admin() inside the function, so requireAdmin() here
 * is the first gate rather than the only one.
 */
export async function retryNotificationAction(input: {
  notificationId: string;
}): Promise<ActionResult> {
  await requireAdmin();

  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION', 'That notification does not exist.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('retry_notification', {
    p_id: parsed.data.notificationId,
  });

  if (error) {
    return fail('ERROR', 'We could not queue that notification for retry.');
  }
  if (!data) {
    return fail('CONFLICT', 'That notification has already been sent, or no longer exists.');
  }

  revalidatePath('/admin/notifications');
  return ok(undefined);
}
