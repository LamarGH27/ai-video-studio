import { describe, expect, it } from 'vitest';
import {
  PROJECT_STATUS_ORDER,
  PROJECT_TIMELINE_STEPS,
  allowedAdminTransitions,
  canAdminTransition,
  missingDeliveryFor,
  isProjectStatus,
  statusLabel,
  timelineIndex,
} from '@/lib/projects/status';
import type { ProjectStatus } from '@/types/database';

describe('status metadata', () => {
  it('has a label for every status in the enum', () => {
    for (const status of PROJECT_STATUS_ORDER) {
      expect(statusLabel(status)).toBeTruthy();
    }
  });

  it('recognises only the statuses the database defines', () => {
    expect(isProjectStatus('SUBMITTED')).toBe(true);
    expect(isProjectStatus('submitted')).toBe(false);
    expect(isProjectStatus('ARCHIVED')).toBe(false);
  });
});

/**
 * The existing cases are about the workflow shape, so they assume both
 * deliveries exist. The delivery-dependent rules get their own block below.
 */
const DELIVERED = { hasPreview: true, hasFinal: true } as const;
const NOTHING_DELIVERED = { hasPreview: false, hasFinal: false } as const;

describe('canAdminTransition', () => {
  it('advances a submitted project through production and delivery', () => {
    expect(canAdminTransition('SUBMITTED', 'ASSETS_REVIEW', DELIVERED)).toBe(true);
    expect(canAdminTransition('ASSETS_REVIEW', 'IN_PRODUCTION', DELIVERED)).toBe(true);
    expect(canAdminTransition('IN_PRODUCTION', 'PREVIEW_READY', DELIVERED)).toBe(true);
    expect(canAdminTransition('FINALISING', 'COMPLETED', DELIVERED)).toBe(true);
  });

  /**
   * The two decisions belonging to the customer. The database permits both —
   * the customer makes them, through their own RPCs — but the admin UI must
   * never offer either, so allowedAdminTransitions() excludes them.
   */
  it('never offers the admin a decision that is the customer’s to make', () => {
    expect(canAdminTransition('PREVIEW_READY', 'FINALISING', DELIVERED)).toBe(false);
    expect(canAdminTransition('PREVIEW_READY', 'REVISION_REQUESTED', DELIVERED)).toBe(false);
    expect(canAdminTransition('DRAFT', 'SUBMITTED', DELIVERED)).toBe(false);
  });

  it('supports the revision branch, which the admin picks up after the customer', () => {
    expect(canAdminTransition('REVISION_REQUESTED', 'IN_PRODUCTION', DELIVERED)).toBe(true);
    // Answering a revision means a new preview, so rework goes through
    // production rather than straight back to the rejected cut.
    expect(canAdminTransition('REVISION_REQUESTED', 'PREVIEW_READY', DELIVERED)).toBe(false);
  });

  it('cannot complete a project without the customer approving first', () => {
    expect(canAdminTransition('PREVIEW_READY', 'COMPLETED', DELIVERED)).toBe(false);
    expect(canAdminTransition('IN_PRODUCTION', 'COMPLETED', DELIVERED)).toBe(false);
    expect(canAdminTransition('SUBMITTED', 'COMPLETED', DELIVERED)).toBe(false);
  });

  // Moving a submitted project back to DRAFT would hand edit rights back to the
  // customer under the "owner can update own draft projects" policy.
  it('never allows a return to DRAFT', () => {
    for (const from of PROJECT_STATUS_ORDER) {
      expect(canAdminTransition(from, 'DRAFT', DELIVERED)).toBe(false);
    }
  });

  it('treats COMPLETED and CANCELLED as final', () => {
    expect(allowedAdminTransitions('COMPLETED', DELIVERED)).toHaveLength(0);
    expect(allowedAdminTransitions('CANCELLED', DELIVERED)).toHaveLength(0);
  });

  it('rejects skipping straight from submitted to completed', () => {
    expect(canAdminTransition('SUBMITTED', 'COMPLETED', DELIVERED)).toBe(false);
    expect(canAdminTransition('SUBMITTED', 'PREVIEW_READY', DELIVERED)).toBe(false);
  });

  it('only ever names statuses that exist', () => {
    for (const from of PROJECT_STATUS_ORDER) {
      for (const to of allowedAdminTransitions(from, DELIVERED)) {
        expect(PROJECT_STATUS_ORDER).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });
});

/**
 * Two of the workflow's rules are not about the status you are coming from but
 * about what has actually been delivered: enforce_project_status_transition()
 * refuses PREVIEW_READY without a preview and COMPLETED without a final video.
 *
 * A transition table that ignores them over-states what the admin can do, and
 * the interface then renders a button the database is certain to reject. That
 * is not a cosmetic problem: the administrator only discovers it after
 * clicking, and an automated caller cannot tell "ready to complete" from
 * "still uploading" — the control looks identical either way.
 */
describe('transitions that depend on a delivery existing', () => {
  it('does not offer completion until a final video exists', () => {
    expect(canAdminTransition('FINALISING', 'COMPLETED', NOTHING_DELIVERED)).toBe(false);
    expect(
      canAdminTransition('FINALISING', 'COMPLETED', { hasPreview: true, hasFinal: false }),
    ).toBe(false);
    expect(canAdminTransition('FINALISING', 'COMPLETED', DELIVERED)).toBe(true);
  });

  it('does not offer Preview ready until a preview exists', () => {
    expect(canAdminTransition('IN_PRODUCTION', 'PREVIEW_READY', NOTHING_DELIVERED)).toBe(false);
    expect(
      canAdminTransition('IN_PRODUCTION', 'PREVIEW_READY', { hasPreview: true, hasFinal: false }),
    ).toBe(true);
  });

  it('still offers the moves that do not depend on media', () => {
    // Cancellation must never be blocked by an upload that never happened.
    expect(canAdminTransition('FINALISING', 'CANCELLED', NOTHING_DELIVERED)).toBe(true);
    expect(canAdminTransition('IN_PRODUCTION', 'ASSETS_REVIEW', NOTHING_DELIVERED)).toBe(true);
    expect(canAdminTransition('SUBMITTED', 'ASSETS_REVIEW', NOTHING_DELIVERED)).toBe(true);
  });

  it('leaves a project in FINALISING with nothing to do but cancel', () => {
    expect([...allowedAdminTransitions('FINALISING', NOTHING_DELIVERED)]).toEqual(['CANCELLED']);
  });

  it('explains which delivery is missing, and only for those two moves', () => {
    expect(missingDeliveryFor('COMPLETED')).toMatch(/final video/i);
    expect(missingDeliveryFor('PREVIEW_READY')).toMatch(/preview/i);
    expect(missingDeliveryFor('CANCELLED')).toBeNull();
    expect(missingDeliveryFor('IN_PRODUCTION')).toBeNull();
  });
});

describe('timelineIndex', () => {
  it('places the happy-path statuses in order', () => {
    const indices = PROJECT_TIMELINE_STEPS.map(timelineIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(indices).not.toContain(-1);
  });

  it('reports branch statuses as off the track', () => {
    const offTrack: ProjectStatus[] = ['DRAFT', 'REVISION_REQUESTED', 'CANCELLED'];
    for (const status of offTrack) {
      expect(timelineIndex(status)).toBe(-1);
    }
  });
});
