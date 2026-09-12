import { describe, expect, it } from 'vitest';
import {
  PROJECT_STATUS_ORDER,
  PROJECT_TIMELINE_STEPS,
  allowedAdminTransitions,
  canAdminTransition,
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

describe('canAdminTransition', () => {
  it('advances a submitted project through production and delivery', () => {
    expect(canAdminTransition('SUBMITTED', 'ASSETS_REVIEW')).toBe(true);
    expect(canAdminTransition('ASSETS_REVIEW', 'IN_PRODUCTION')).toBe(true);
    expect(canAdminTransition('IN_PRODUCTION', 'PREVIEW_READY')).toBe(true);
    expect(canAdminTransition('FINALISING', 'COMPLETED')).toBe(true);
  });

  /**
   * The two decisions belonging to the customer. The database permits both —
   * the customer makes them, through their own RPCs — but the admin UI must
   * never offer either, so allowedAdminTransitions() excludes them.
   */
  it('never offers the admin a decision that is the customer’s to make', () => {
    expect(canAdminTransition('PREVIEW_READY', 'FINALISING')).toBe(false);
    expect(canAdminTransition('PREVIEW_READY', 'REVISION_REQUESTED')).toBe(false);
    expect(canAdminTransition('DRAFT', 'SUBMITTED')).toBe(false);
  });

  it('supports the revision branch, which the admin picks up after the customer', () => {
    expect(canAdminTransition('REVISION_REQUESTED', 'IN_PRODUCTION')).toBe(true);
    // Answering a revision means a new preview, so rework goes through
    // production rather than straight back to the rejected cut.
    expect(canAdminTransition('REVISION_REQUESTED', 'PREVIEW_READY')).toBe(false);
  });

  it('cannot complete a project without the customer approving first', () => {
    expect(canAdminTransition('PREVIEW_READY', 'COMPLETED')).toBe(false);
    expect(canAdminTransition('IN_PRODUCTION', 'COMPLETED')).toBe(false);
    expect(canAdminTransition('SUBMITTED', 'COMPLETED')).toBe(false);
  });

  // Moving a submitted project back to DRAFT would hand edit rights back to the
  // customer under the "owner can update own draft projects" policy.
  it('never allows a return to DRAFT', () => {
    for (const from of PROJECT_STATUS_ORDER) {
      expect(canAdminTransition(from, 'DRAFT')).toBe(false);
    }
  });

  it('treats COMPLETED and CANCELLED as final', () => {
    expect(allowedAdminTransitions('COMPLETED')).toHaveLength(0);
    expect(allowedAdminTransitions('CANCELLED')).toHaveLength(0);
  });

  it('rejects skipping straight from submitted to completed', () => {
    expect(canAdminTransition('SUBMITTED', 'COMPLETED')).toBe(false);
    expect(canAdminTransition('SUBMITTED', 'PREVIEW_READY')).toBe(false);
  });

  it('only ever names statuses that exist', () => {
    for (const from of PROJECT_STATUS_ORDER) {
      for (const to of allowedAdminTransitions(from)) {
        expect(PROJECT_STATUS_ORDER).toContain(to);
        expect(to).not.toBe(from);
      }
    }
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
