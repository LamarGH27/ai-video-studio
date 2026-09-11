import { Check } from 'lucide-react';
import {
  PROJECT_TIMELINE_STEPS,
  statusDescription,
  statusLabel,
  timelineIndex,
} from '@/lib/projects/status';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { ProjectStatus, ProjectStatusHistoryRow } from '@/types/database';

/**
 * Customer-facing production timeline.
 *
 * Statuses outside the happy path (REVISION_REQUESTED, CANCELLED) are not steps
 * on the track — they are shown as the current state above it instead.
 */
export function ProjectTimeline({
  status,
  history,
}: {
  status: ProjectStatus;
  history: readonly ProjectStatusHistoryRow[];
}) {
  const currentIndex = timelineIndex(status);
  const isOffTrack = currentIndex === -1;

  const reachedAt = new Map<ProjectStatus, string>();
  for (const entry of history) {
    if (!reachedAt.has(entry.to_status)) reachedAt.set(entry.to_status, entry.created_at);
  }

  return (
    <div>
      {isOffTrack ? (
        <p className="mb-6 text-sm leading-relaxed text-bone-400">{statusDescription(status)}</p>
      ) : null}

      <ol className="space-y-0">
        {PROJECT_TIMELINE_STEPS.map((step, index) => {
          const isDone = !isOffTrack && index < currentIndex;
          const isCurrent = !isOffTrack && index === currentIndex;
          const timestamp = reachedAt.get(step);
          const isLast = index === PROJECT_TIMELINE_STEPS.length - 1;

          return (
            <li key={step} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border',
                    isCurrent && 'border-brass-400 bg-brass-400 text-ink-950',
                    isDone && 'border-brass-400/40 text-brass-300',
                    !isDone && !isCurrent && 'border-white/15 text-bone-400/50',
                  )}
                >
                  {isDone ? (
                    <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-current" />
                  )}
                </span>
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={cn('w-px flex-1', isDone ? 'bg-brass-400/30' : 'bg-white/10')}
                  />
                ) : null}
              </div>

              <div className={cn('pb-8', isLast && 'pb-0')}>
                <p
                  className={cn(
                    'text-sm font-medium',
                    isCurrent ? 'text-bone-50' : 'text-bone-400',
                  )}
                >
                  {statusLabel(step)}
                  {isCurrent ? <span className="sr-only"> (current stage)</span> : null}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-bone-400/80">
                  {statusDescription(step)}
                </p>
                {timestamp ? (
                  <p className="mt-1.5 text-xs text-bone-400/60">{formatDateTime(timestamp)}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
