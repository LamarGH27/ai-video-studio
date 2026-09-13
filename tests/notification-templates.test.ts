import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENT_TYPES, EVENT_RECIPIENT } from '@/lib/notifications/events';
import { renderNotificationEmail, type NotificationContext } from '@/lib/notifications/templates';
import { escapeHtml } from '@/lib/notifications/templates/layout';

/**
 * An email is an unauthenticated document. It sits in an inbox for years, gets
 * forwarded, is indexed by the mail provider, and is sometimes read on a screen
 * somebody else can see. So what these tests mostly check is what is NOT in it.
 */

const PROJECT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const REFERENCE = 'AVS-000123';
const SITE = 'https://studio.example.com';

const context: NotificationContext = {
  reference: REFERENCE,
  siteUrl: SITE,
  projectId: PROJECT_ID,
  previewVersion: 2,
};

const rendered = NOTIFICATION_EVENT_TYPES.map((eventType) => ({
  eventType,
  email: renderNotificationEmail(eventType, context),
}));

describe('every transactional email', () => {
  it.each(rendered)('$eventType has a subject, both bodies and a preheader', ({ email }) => {
    expect(email.subject.length).toBeGreaterThan(10);
    expect(email.subject.length).toBeLessThanOrEqual(120);
    expect(email.preheader.length).toBeGreaterThan(10);
    expect(email.html).toContain('<!doctype html>');
    // A text part is not optional: some clients render it, some filters demand
    // it, and an HTML-only message is likelier to be treated as bulk.
    expect(email.text.length).toBeGreaterThan(80);
  });

  it.each(rendered)('$eventType names the project by its public reference', ({ email }) => {
    expect(email.subject).toContain(REFERENCE);
    expect(email.html).toContain(REFERENCE);
    expect(email.text).toContain(REFERENCE);
  });

  /**
   * The single most important assertion here. A UUID in an email is an internal
   * identifier leaking into a document we do not control; the customer-facing
   * name for a project is AVS-000123 and there is no reason for anything else
   * to be visible.
   */
  it.each(rendered)('$eventType never shows a UUID in its visible copy', ({ email }) => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    // The link is allowed to carry the project id — that is what a route is.
    // Everything else must not.
    const withoutLinks = email.html.replace(/https?:\/\/[^\s"'<>]+/g, '');
    expect(withoutLinks).not.toMatch(uuid);

    const textWithoutLinks = email.text.replace(/https?:\/\/\S+/g, '');
    expect(textWithoutLinks).not.toMatch(uuid);
  });

  it.each(rendered)('$eventType carries no media, storage path or signed URL', ({ email }) => {
    for (const body of [email.html, email.text]) {
      expect(body).not.toContain('/storage/v1/');
      expect(body).not.toContain('token=');
      expect(body).not.toMatch(/\.(mp4|webm|jpg|jpeg|png|webp)\b/i);
      expect(body).not.toContain('supabase.co');
      // No attachments, and nothing that would embed private media remotely.
      expect(body).not.toMatch(/<img\b/i);
    }
  });

  it.each(rendered)('$eventType links only into this application', ({ email }) => {
    const urls = [...email.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith(`${SITE}/`), `${url} points outside the application`).toBe(true);
    }
  });

  it.each(rendered)('$eventType sends its audience to the right area', ({ eventType, email }) => {
    const expectedPath =
      EVENT_RECIPIENT[eventType] === 'ADMIN'
        ? `${SITE}/admin/projects/${PROJECT_ID}`
        : `${SITE}/dashboard/projects/${PROJECT_ID}`;
    expect(email.html).toContain(`href="${expectedPath}"`);
    expect(email.text).toContain(expectedPath);
  });

  it.each(rendered)('$eventType needs no remote stylesheet or script', ({ email }) => {
    expect(email.html).not.toMatch(/<link\b/i);
    expect(email.html).not.toMatch(/<script\b/i);
    // Inline styles only: <style> blocks are stripped by several clients.
    expect(email.html).not.toMatch(/<style\b/i);
    expect(email.html).toContain('style="');
  });
});

describe('the messages themselves', () => {
  const byType = Object.fromEntries(rendered.map((r) => [r.eventType, r.email]));

  it('uses the subjects the brief specifies', () => {
    expect(byType.PROJECT_SUBMITTED_CUSTOMER!.subject).toBe(
      `We have received your video project — ${REFERENCE}`,
    );
    expect(byType.PREVIEW_READY_CUSTOMER!.subject).toBe(`Your preview is ready — ${REFERENCE}`);
    expect(byType.PREVIEW_REVISED_CUSTOMER!.subject).toBe(
      `Your updated preview is ready — ${REFERENCE}`,
    );
    expect(byType.PREVIEW_APPROVED_CUSTOMER!.subject).toBe(`Preview approved — ${REFERENCE}`);
    expect(byType.FINAL_VIDEO_READY_CUSTOMER!.subject).toBe(
      `Your final video is ready — ${REFERENCE}`,
    );
    expect(byType.PROJECT_SUBMITTED_ADMIN!.subject).toBe(`New project submitted — ${REFERENCE}`);
    expect(byType.REVISION_REQUESTED_ADMIN!.subject).toBe(`Revision requested — ${REFERENCE}`);
    expect(byType.PREVIEW_APPROVED_ADMIN!.subject).toBe(
      `Preview approved by customer — ${REFERENCE}`,
    );
  });

  it('distinguishes a first preview from a replacement', () => {
    expect(byType.PREVIEW_READY_CUSTOMER!.subject).not.toContain('updated');
    expect(byType.PREVIEW_REVISED_CUSTOMER!.subject).toContain('updated');
    expect(byType.PREVIEW_REVISED_CUSTOMER!.text).toContain('Preview 2');
  });

  it('explains the two choices a preview email is asking for', () => {
    const text = byType.PREVIEW_READY_CUSTOMER!.text;
    expect(text).toMatch(/Approve Preview/);
    expect(text).toMatch(/Request Revision/);
  });

  /**
   * The revision request is the customer's own words about their film. The
   * admin reads it in the portal; an inbox is not the place for it, and a
   * forwarded operations email should not carry it.
   */
  it('tells the team about a revision without repeating what was said', () => {
    const email = byType.REVISION_REQUESTED_ADMIN!;
    expect(email.text).toMatch(/asked for changes/i);
    expect(email.text).toMatch(/on the project page/i);
    expect(email.text.length).toBeLessThan(900);
  });

  it('renders without a preview version when none is known', () => {
    const email = renderNotificationEmail('PREVIEW_REVISED_CUSTOMER', {
      reference: REFERENCE,
      siteUrl: SITE,
      projectId: PROJECT_ID,
    });
    expect(email.text).not.toContain('undefined');
    expect(email.text).not.toContain('NaN');
    expect(email.html).not.toContain('undefined');
  });

  it('tolerates a site URL with a trailing slash', () => {
    const email = renderNotificationEmail('PREVIEW_READY_CUSTOMER', {
      ...context,
      siteUrl: `${SITE}/`,
    });
    expect(email.html).toContain(`href="${SITE}/dashboard/projects/${PROJECT_ID}"`);
    expect(email.html).not.toContain('//dashboard');
  });
});

describe('escaping', () => {
  it('neutralises markup in anything interpolated', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml(`" onload='x'`)).toBe('&quot; onload=&#39;x&#39;');
  });

  it('escapes the project reference rather than trusting its shape', () => {
    const email = renderNotificationEmail('PREVIEW_READY_CUSTOMER', {
      ...context,
      reference: 'AVS-1"><script>x</script>',
    });
    expect(email.html).not.toContain('<script>x</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
