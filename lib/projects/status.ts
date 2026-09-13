import type { ProjectOrientation, ProjectStatus } from '@/types/database';

interface StatusMeta {
  label: string;
  /** Customer-facing explanation shown on the dashboard and project timeline. */
  description: string;
  /** Tailwind classes for the status badge. */
  tone: string;
}

// Declared in the same order as the public.project_status enum.
export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'ASSETS_REVIEW',
  'IN_PRODUCTION',
  'PREVIEW_READY',
  'FINALISING',
  'REVISION_REQUESTED',
  'COMPLETED',
  'CANCELLED',
] as const;

/**
 * The happy-path timeline shown to customers. REVISION_REQUESTED and CANCELLED
 * are real statuses but are branches, not steps, so they are rendered inline
 * rather than as part of the track.
 */
export const PROJECT_TIMELINE_STEPS: readonly ProjectStatus[] = [
  'SUBMITTED',
  'ASSETS_REVIEW',
  'IN_PRODUCTION',
  'PREVIEW_READY',
  'FINALISING',
  'COMPLETED',
] as const;

const STATUS_META: Record<ProjectStatus, StatusMeta> = {
  DRAFT: {
    label: 'Draft',
    description: 'Not submitted yet. You can still change anything in this brief.',
    tone: 'border-white/15 bg-white/[0.04] text-bone-300',
  },
  SUBMITTED: {
    label: 'Submitted',
    description: 'Received. Your brief is queued for a producer to read.',
    tone: 'border-white/20 bg-white/[0.05] text-bone-200',
  },
  ASSETS_REVIEW: {
    label: 'Assets in review',
    description: 'A producer is checking your reference images are usable.',
    tone: 'border-white/20 bg-white/[0.05] text-bone-200',
  },
  IN_PRODUCTION: {
    label: 'In production',
    description: 'Your film is being made.',
    tone: 'border-bone-50/25 bg-bone-50/[0.07] text-bone-100',
  },
  PREVIEW_READY: {
    label: 'Preview ready',
    description: 'A preview cut is ready for you to review.',
    tone: 'border-brass-400/50 bg-brass-400/12 text-brass-200',
  },
  FINALISING: {
    label: 'Finalising',
    description: 'You approved the preview. Your final cut is being prepared.',
    tone: 'border-bone-50/25 bg-bone-50/[0.07] text-bone-100',
  },
  REVISION_REQUESTED: {
    label: 'Revision requested',
    description: 'Your notes are with the production team.',
    tone: 'border-brass-400/30 bg-brass-400/[0.07] text-brass-300',
  },
  COMPLETED: {
    label: 'Completed',
    description: 'Delivered. Your final film is available on this project.',
    tone: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200',
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'This project is closed and is no longer in production.',
    tone: 'border-rose-400/30 bg-rose-400/[0.07] text-rose-200',
  },
};

/**
 * What a customer is told, in a sentence written for them.
 *
 * The enum names are ours: IN_PRODUCTION is an engineering fact and a stranger
 * reading it learns nothing. These are the same nine states said in the second
 * person, and they are what the dashboard and the project page lead with. The
 * internal label stays available for the badge and for staff screens.
 */
const CUSTOMER_HEADLINES: Record<ProjectStatus, string> = {
  DRAFT: 'Your brief is unfinished',
  SUBMITTED: 'We have your brief',
  ASSETS_REVIEW: 'We are checking your photos',
  IN_PRODUCTION: 'Your film is being created',
  PREVIEW_READY: 'Your preview is ready to watch',
  FINALISING: 'We are finishing your film',
  REVISION_REQUESTED: 'Your changes are with the team',
  COMPLETED: 'Your film is ready',
  CANCELLED: 'This project is closed',
};

/** The one thing, if anything, the customer needs to do next. */
const CUSTOMER_NEXT_ACTION: Record<ProjectStatus, string | null> = {
  DRAFT: 'Finish your brief',
  SUBMITTED: null,
  ASSETS_REVIEW: null,
  IN_PRODUCTION: null,
  PREVIEW_READY: 'Watch and decide',
  FINALISING: null,
  REVISION_REQUESTED: null,
  COMPLETED: 'Watch and download',
  CANCELLED: null,
};

export function customerHeadline(status: ProjectStatus): string {
  return CUSTOMER_HEADLINES[status];
}

export function customerNextAction(status: ProjectStatus): string | null {
  return CUSTOMER_NEXT_ACTION[status];
}

/** True while the project is waiting on the customer rather than on us. */
export function isWaitingOnCustomer(status: ProjectStatus): boolean {
  return status === 'PREVIEW_READY' || status === 'DRAFT';
}

export function statusLabel(status: ProjectStatus): string {
  return STATUS_META[status].label;
}

export function statusDescription(status: ProjectStatus): string {
  return STATUS_META[status].description;
}

export function statusTone(status: ProjectStatus): string {
  return STATUS_META[status].tone;
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUS_ORDER as readonly string[]).includes(value);
}

/** Where a project sits on the customer-facing timeline. -1 when off-track. */
export function timelineIndex(status: ProjectStatus): number {
  return PROJECT_TIMELINE_STEPS.indexOf(status);
}

/**
 * The production workflow.
 *
 * `public.allowed_status_transitions()` in
 * supabase/migrations/20260101000600_delivery_workflow.sql is the AUTHORITY —
 * a database trigger rejects anything outside it, whoever the caller is. This
 * table is a mirror, used only to decide which controls to render.
 *
 * tests/status-model-consistency.test.ts parses the migration and fails if the
 * two ever disagree, so this cannot quietly drift.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['ASSETS_REVIEW', 'IN_PRODUCTION', 'CANCELLED'],
  ASSETS_REVIEW: ['IN_PRODUCTION', 'SUBMITTED', 'CANCELLED'],
  IN_PRODUCTION: ['PREVIEW_READY', 'ASSETS_REVIEW', 'CANCELLED'],
  PREVIEW_READY: ['REVISION_REQUESTED', 'FINALISING', 'CANCELLED'],
  REVISION_REQUESTED: ['IN_PRODUCTION', 'CANCELLED'],
  FINALISING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * The one status in which each kind of delivery may be created.
 *
 * This is a MIRROR. The authority is enforce_delivery_asset_status() in
 * migration 000600, which locks the project row and refuses anything else for
 * every caller — server action, direct PostgREST request, psql. This constant
 * exists so the interface can offer the right control and the server action can
 * fail early with a sentence rather than a constraint violation.
 * tests/status-model-consistency.test.ts parses the migration and fails if the
 * two ever disagree.
 *
 * PREVIEW_READY is deliberately absent. While a project is PREVIEW_READY the
 * customer may be part-way through deciding on the preview in front of them,
 * and a replacement arriving underneath them is exactly the problem the
 * database now makes unreachable. Rework returns through IN_PRODUCTION.
 */
export const DELIVERY_UPLOAD_STATUS: Readonly<
  Record<'PREVIEW_VIDEO' | 'FINAL_VIDEO', ProjectStatus>
> = {
  PREVIEW_VIDEO: 'IN_PRODUCTION',
  FINAL_VIDEO: 'FINALISING',
} as const;

/**
 * Transitions that belong to the customer, not to staff.
 *
 * The database permits these — a customer performs them — but an administrator
 * must never be offered them. Approving a preview on the customer's behalf
 * would be putting words in their mouth, and each is additionally reachable
 * only through its own RPC, so an admin cannot make them even by crafting a
 * request.
 */
const CUSTOMER_ONLY_TRANSITIONS: readonly (readonly [ProjectStatus, ProjectStatus])[] = [
  ['DRAFT', 'SUBMITTED'],
  ['PREVIEW_READY', 'FINALISING'],
  ['PREVIEW_READY', 'REVISION_REQUESTED'],
] as const;

function isCustomerOnly(from: ProjectStatus, to: ProjectStatus): boolean {
  return CUSTOMER_ONLY_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/**
 * What delivery media a project already has.
 *
 * Two of the workflow's rules are not about the status you are coming from,
 * but about what exists: a project cannot become PREVIEW_READY without a
 * preview, and cannot become COMPLETED without a final video.
 * enforce_project_status_transition() rejects both, so a transition table alone
 * over-states what an administrator can do — and a button that the database is
 * certain to refuse is worse than no button, because the admin discovers it
 * only after clicking.
 */
export interface DeliveryPresence {
  hasPreview: boolean;
  hasFinal: boolean;
}

/**
 * What the admin UI may offer: the workflow, minus the customer's own
 * decisions, minus the moves the database would refuse for want of a delivery.
 *
 * `deliveries` is required rather than optional on purpose. Defaulting it would
 * let a caller silently get the over-permissive answer, which is the bug this
 * parameter exists to prevent.
 */
export function allowedAdminTransitions(
  from: ProjectStatus,
  deliveries: DeliveryPresence,
): readonly ProjectStatus[] {
  return ALLOWED_STATUS_TRANSITIONS[from].filter((to) => {
    if (isCustomerOnly(from, to)) return false;
    if (to === 'PREVIEW_READY' && !deliveries.hasPreview) return false;
    if (to === 'COMPLETED' && !deliveries.hasFinal) return false;
    return true;
  });
}

export function canAdminTransition(
  from: ProjectStatus,
  to: ProjectStatus,
  deliveries: DeliveryPresence,
): boolean {
  return allowedAdminTransitions(from, deliveries).includes(to);
}

/**
 * Why a transition the workflow permits is nonetheless unavailable right now.
 * Returns null when the transition is not blocked by missing media — either it
 * is available, or it was never permitted in the first place.
 */
export function missingDeliveryFor(to: ProjectStatus): string | null {
  if (to === 'PREVIEW_READY')
    return 'Upload a preview before moving this project to Preview ready.';
  if (to === 'COMPLETED') return 'Upload the final video before completing this project.';
  return null;
}

/**
 * The single production action an administrator should take next, if any.
 * Drives the admin workspace's call to action.
 */
export interface NextAdminAction {
  label: string;
  hint: string;
  /** A status change; absent when the next action is an upload or nothing. */
  transitionTo?: ProjectStatus;
  /** The delivery the admin must upload before anything else can happen. */
  upload?: 'PREVIEW_VIDEO' | 'FINAL_VIDEO';
}

export function nextAdminAction(status: ProjectStatus): NextAdminAction | null {
  switch (status) {
    case 'SUBMITTED':
      return {
        label: 'Start Asset Review',
        hint: 'Check the reference images are usable before committing to production.',
        transitionTo: 'ASSETS_REVIEW',
      };
    case 'ASSETS_REVIEW':
      return {
        label: 'Begin Production',
        hint: 'The references are good. Move this into production.',
        transitionTo: 'IN_PRODUCTION',
      };
    case 'IN_PRODUCTION':
      return {
        label: 'Upload Preview',
        hint: 'Upload a preview cut. The project moves to Preview ready once it lands.',
        upload: 'PREVIEW_VIDEO',
      };
    case 'PREVIEW_READY':
      return {
        label: 'Waiting for customer',
        hint: 'The customer is deciding whether to approve this preview or request changes.',
      };
    case 'REVISION_REQUESTED':
      return {
        label: 'Begin Revision',
        hint: 'Read the request below, then move back into production to rework it.',
        transitionTo: 'IN_PRODUCTION',
      };
    case 'FINALISING':
      return {
        label: 'Upload Final Video',
        hint: 'The customer approved the preview. Upload the final cut, then complete the project.',
        upload: 'FINAL_VIDEO',
      };
    case 'DRAFT':
    case 'COMPLETED':
    case 'CANCELLED':
      return null;
  }
}

const ORIENTATION_META: Record<ProjectOrientation, { label: string; ratio: string; hint: string }> =
  {
    VERTICAL_9_16: {
      label: 'Vertical',
      ratio: '9:16',
      hint: 'Reels, TikTok, Stories',
    },
    LANDSCAPE_16_9: {
      label: 'Landscape',
      ratio: '16:9',
      hint: 'YouTube, websites, presentations',
    },
    SQUARE_1_1: {
      label: 'Square',
      ratio: '1:1',
      hint: 'Feed posts, ads',
    },
  };

export const PROJECT_ORIENTATIONS: readonly ProjectOrientation[] = [
  'VERTICAL_9_16',
  'LANDSCAPE_16_9',
  'SQUARE_1_1',
] as const;

export function orientationLabel(orientation: ProjectOrientation): string {
  const meta = ORIENTATION_META[orientation];
  return `${meta.label} ${meta.ratio}`;
}

export function orientationMeta(orientation: ProjectOrientation) {
  return ORIENTATION_META[orientation];
}
