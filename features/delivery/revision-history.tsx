import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';
import type { ProjectRevisionRow } from '@/types/database';

/**
 * Revision requests, newest first.
 *
 * Resolved requests stay visible. The record of what was asked for and when it
 * was answered is the useful part for both the customer and support, so nothing
 * here is ever removed — the database has no delete policy for it either.
 */
export function RevisionHistory({
  revisions,
  emptyMessage = 'No changes have been requested.',
}: {
  revisions: readonly ProjectRevisionRow[];
  emptyMessage?: string;
}) {
  if (revisions.length === 0) {
    return <p className="text-sm text-bone-400">{emptyMessage}</p>;
  }

  return (
    <ol className="space-y-4">
      {revisions.map((revision) => (
        <li key={revision.id} className="rounded-panel border border-white/10 bg-white/[0.02] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs tracking-wide text-bone-400 uppercase">
              Requested {formatDateTime(revision.requested_at)}
            </p>
            {revision.status === 'OPEN' ? (
              <Badge className="border-orange-400/30 bg-orange-400/10 text-orange-200">Open</Badge>
            ) : (
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
                Resolved
              </Badge>
            )}
          </div>

          <p className="text-bone-100 mt-3 leading-relaxed whitespace-pre-wrap">
            {revision.message}
          </p>

          {revision.resolved_at ? (
            <p className="mt-3 text-xs text-bone-400/70">
              Answered with a new preview on {formatDateTime(revision.resolved_at)}.
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
