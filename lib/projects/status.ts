import type { ProjectOrientation, ProjectStatus } from '@/types/database';

interface StatusMeta {
  label: string;
  /** Customer-facing explanation shown on the dashboard and project timeline. */
  description: string;
  /** Tailwind classes for the status badge. */
  tone: string;
}

export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'ASSETS_REVIEW',
  'IN_PRODUCTION',
  'PREVIEW_READY',
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
  'COMPLETED',
] as const;

const STATUS_META: Record<ProjectStatus, StatusMeta> = {
  DRAFT: {
    label: 'Draft',
    description: 'Not submitted yet. You can still change anything in this brief.',
    tone: 'border-white/15 bg-white/5 text-white/70',
  },
  SUBMITTED: {
    label: 'Submitted',
    description: 'Received. Your brief is queued for a producer to read.',
    tone: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  },
  ASSETS_REVIEW: {
    label: 'Assets in review',
    description: 'A producer is checking your reference images are usable.',
    tone: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  },
  IN_PRODUCTION: {
    label: 'In production',
    description: 'Your film is being made.',
    tone: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  },
  PREVIEW_READY: {
    label: 'Preview ready',
    description: 'A preview cut is ready for you to review.',
    tone: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
  },
  REVISION_REQUESTED: {
    label: 'Revision requested',
    description: 'Your notes are with the production team.',
    tone: 'border-orange-400/30 bg-orange-400/10 text-orange-200',
  },
  COMPLETED: {
    label: 'Completed',
    description: 'Delivered. Your final film is available on this project.',
    tone: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'This project is closed and is no longer in production.',
    tone: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  },
};

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
 * Admin status transitions.
 *
 * Kept deliberately narrow: an admin advances, branches to a revision, or
 * cancels. Anything not listed here is rejected server-side. DRAFT is absent as
 * a destination because a submitted brief must never silently become editable
 * by the customer again.
 */
const ALLOWED_ADMIN_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ['CANCELLED'],
  SUBMITTED: ['ASSETS_REVIEW', 'IN_PRODUCTION', 'CANCELLED'],
  ASSETS_REVIEW: ['IN_PRODUCTION', 'SUBMITTED', 'CANCELLED'],
  IN_PRODUCTION: ['PREVIEW_READY', 'ASSETS_REVIEW', 'CANCELLED'],
  PREVIEW_READY: ['REVISION_REQUESTED', 'COMPLETED', 'CANCELLED'],
  REVISION_REQUESTED: ['IN_PRODUCTION', 'PREVIEW_READY', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function allowedAdminTransitions(from: ProjectStatus): readonly ProjectStatus[] {
  return ALLOWED_ADMIN_TRANSITIONS[from];
}

export function canAdminTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return ALLOWED_ADMIN_TRANSITIONS[from].includes(to);
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
