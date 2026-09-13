import { Alert } from '@/components/ui/alert';
import { DeliveryUploader } from '@/features/delivery/delivery-uploader';
import { StatusControl } from '@/features/admin/status-control';
import {
  nextAdminAction,
  allowedAdminTransitions,
  statusLabel,
  type DeliveryPresence,
} from '@/lib/projects/status';
import type { ProjectStatus } from '@/types/database';

/**
 * The one thing to do next.
 *
 * An admin opening a project should not have to work out which of nine statuses
 * implies which action. This states it, and offers exactly that action —
 * an upload, a transition, or nothing at all when the ball is in the customer's
 * court. The full transition control stays below for the cases the happy path
 * does not cover (cancelling, stepping back a stage).
 */
export function NextActionPanel({
  projectId,
  status,
  deliveries,
}: {
  projectId: string;
  status: ProjectStatus;
  deliveries: DeliveryPresence;
}) {
  const action = nextAdminAction(status);
  const transitions = allowedAdminTransitions(status, deliveries);

  return (
    <section aria-labelledby="next-action-heading" className="space-y-5">
      <h2 id="next-action-heading" className="eyebrow">
        Next production action
      </h2>

      {action === null ? (
        <Alert tone={status === 'COMPLETED' ? 'success' : 'info'}>
          {status === 'COMPLETED'
            ? 'Delivered. Nothing further is required.'
            : `This project is ${statusLabel(status).toLowerCase()}. No production action is required.`}
        </Alert>
      ) : (
        <div className="rounded-panel border border-brass-400/35 bg-brass-400/[0.055] p-6 sm:p-7">
          <p className="display-heading text-2xl">{action.label}</p>
          <p className="mt-2.5 text-sm leading-relaxed text-bone-300">{action.hint}</p>

          {action.upload ? (
            <div className="mt-6">
              <DeliveryUploader
                projectId={projectId}
                assetType={action.upload}
                label={action.label}
                hint={
                  action.upload === 'PREVIEW_VIDEO'
                    ? 'The customer is notified by the project moving to Preview ready.'
                    : 'Upload the final cut, then mark the project completed.'
                }
              />
            </div>
          ) : null}
        </div>
      )}

      <div>
        <h3 className="text-[0.65rem] tracking-[0.2em] text-bone-500 uppercase">
          {transitions.length > 0 ? 'Other permitted transitions' : 'Transitions'}
        </h3>
        <p className="mt-2.5 text-xs leading-relaxed text-bone-500">
          Only moves the database permits are shown — and it re-checks every one, so these buttons
          reflect the rules rather than enforcing them.
        </p>
        <div className="mt-4">
          <StatusControl projectId={projectId} currentStatus={status} allowed={transitions} />
        </div>
      </div>
    </section>
  );
}
