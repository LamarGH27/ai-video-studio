import type { NotificationEventType } from '../events';
import { renderEmailLayout } from './layout';

/**
 * The eight transactional messages.
 *
 * What every one of them deliberately does NOT contain: a project UUID, an
 * asset id, a storage path, a signed URL, the customer's brief, their reference
 * images, their consent record, or anything an administrator can see that they
 * cannot. An email is an unauthenticated document that sits in an inbox
 * forever, gets forwarded, and is indexed by the mail provider — so it carries
 * the public reference and a link, and the link leads to a page that checks who
 * is asking.
 *
 * The CTA is always a normal application route. Possessing the URL grants
 * nothing: /dashboard/projects/{id} is behind auth and RLS, and the delivery
 * route re-authorises on every request.
 */

export interface NotificationContext {
  /** Public reference, e.g. AVS-000123. Never the UUID. */
  reference: string;
  /** Absolute origin of the application, e.g. https://studio.example.com. */
  siteUrl: string;
  /** Project UUID — used ONLY to build the link, never rendered as text. */
  projectId: string;
  /** Present on preview events. */
  previewVersion?: number;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

function customerProjectUrl(context: NotificationContext): string {
  return `${context.siteUrl.replace(/\/$/, '')}/dashboard/projects/${context.projectId}`;
}

function adminProjectUrl(context: NotificationContext): string {
  return `${context.siteUrl.replace(/\/$/, '')}/admin/projects/${context.projectId}`;
}

type Builder = (context: NotificationContext) => RenderedEmail;

function build(
  context: NotificationContext,
  parts: {
    subject: string;
    heading: string;
    preheader: string;
    paragraphs: readonly string[];
    cta: { label: string; url: string };
    footnote?: string;
  },
): RenderedEmail {
  const { html, text } = renderEmailLayout({
    heading: parts.heading,
    preheader: parts.preheader,
    paragraphs: parts.paragraphs,
    cta: parts.cta,
    reference: context.reference,
    footnote: parts.footnote,
  });

  return { subject: parts.subject, preheader: parts.preheader, html, text };
}

const BUILDERS: Readonly<Record<NotificationEventType, Builder>> = {
  // ---------------------------------------------------------------- customer
  PROJECT_SUBMITTED_CUSTOMER: (context) =>
    build(context, {
      subject: `We have received your video project — ${context.reference}`,
      heading: 'Your project is with us.',
      preheader: 'We have your brief and references. Here is what happens next.',
      paragraphs: [
        'Thank you — your brief and reference images have arrived safely, and your project is now in our queue.',
        'Our team reviews the references first to be sure they will produce the result you are after, then begins production. When your first preview is ready we will email you to review it, and nothing is finished until you approve it.',
        'There is nothing you need to do in the meantime.',
      ],
      cta: { label: 'View your project', url: customerProjectUrl(context) },
    }),

  PREVIEW_READY_CUSTOMER: (context) =>
    build(context, {
      subject: `Your preview is ready — ${context.reference}`,
      heading: 'Your preview is ready to watch.',
      preheader: 'Watch it through, then approve it or tell us what to change.',
      paragraphs: [
        'Your first preview is ready. Sign in to watch it in full.',
        'When you have seen it, choose one of two things: Approve Preview, and we will prepare your final cut — or Request Revision, and tell us in your own words what should be different. One request at a time, and we will rework it.',
        'Nothing happens until you decide.',
      ],
      cta: { label: 'Review your preview', url: customerProjectUrl(context) },
      footnote: 'Your preview is private and plays only while you are signed in.',
    }),

  PREVIEW_REVISED_CUSTOMER: (context) =>
    build(context, {
      subject: `Your updated preview is ready — ${context.reference}`,
      heading: 'We have reworked your preview.',
      preheader: 'Your changes have been made. Take a look when you have a moment.',
      paragraphs: [
        context.previewVersion
          ? `We have made the changes you asked for. Preview ${context.previewVersion} is ready to watch.`
          : 'We have made the changes you asked for, and your updated preview is ready to watch.',
        'As before: approve it and we will prepare the final cut, or tell us what still is not right. Your earlier previews are all kept, so nothing has been lost.',
      ],
      cta: { label: 'Review your updated preview', url: customerProjectUrl(context) },
      footnote: 'Your preview is private and plays only while you are signed in.',
    }),

  PREVIEW_APPROVED_CUSTOMER: (context) =>
    build(context, {
      subject: `Preview approved — ${context.reference}`,
      heading: 'Approved. We are finishing your film.',
      preheader: 'We have your approval and are preparing the final cut.',
      paragraphs: [
        'Thank you for approving your preview. We are now preparing the final version at full quality.',
        'We will email you once it is ready to watch and download. Nothing further is needed from you.',
      ],
      cta: { label: 'View your project', url: customerProjectUrl(context) },
    }),

  FINAL_VIDEO_READY_CUSTOMER: (context) =>
    build(context, {
      subject: `Your final video is ready — ${context.reference}`,
      heading: 'Your film is ready.',
      preheader: 'Your final video is ready to watch and download.',
      paragraphs: [
        'Your final video is finished and waiting for you. Sign in to watch it, and download it to keep.',
        'If anything is not as you expected, reply to this message quoting your project reference and we will look into it.',
      ],
      cta: { label: 'Watch and download your film', url: customerProjectUrl(context) },
      footnote:
        'Your download link is created fresh each time you sign in, so it cannot be shared by accident.',
    }),

  // ------------------------------------------------------------------- admin
  PROJECT_SUBMITTED_ADMIN: (context) =>
    build(context, {
      subject: `New project submitted — ${context.reference}`,
      heading: 'A new project has been submitted.',
      preheader: 'A customer has submitted a brief and is waiting on asset review.',
      paragraphs: [
        'A customer has submitted a new project. It is waiting for asset review.',
        'The brief, reference images and consent record are in the admin workspace.',
      ],
      cta: { label: 'Open project', url: adminProjectUrl(context) },
    }),

  REVISION_REQUESTED_ADMIN: (context) =>
    build(context, {
      subject: `Revision requested — ${context.reference}`,
      heading: 'A customer has requested changes.',
      preheader: 'A revision request is waiting on this project.',
      paragraphs: [
        'A customer has reviewed their preview and asked for changes.',
        // The request itself stays behind authentication. It is the customer's
        // words about their own film, and an inbox is not the place for it.
        'Their request is on the project page, along with the preview it refers to.',
      ],
      cta: { label: 'Open project', url: adminProjectUrl(context) },
    }),

  PREVIEW_APPROVED_ADMIN: (context) =>
    build(context, {
      subject: `Preview approved by customer — ${context.reference}`,
      heading: 'A customer has approved their preview.',
      preheader: 'This project is cleared for the final cut.',
      paragraphs: [
        'A customer has approved their preview. The project is now finalising and is waiting for the final video.',
      ],
      cta: { label: 'Open project', url: adminProjectUrl(context) },
    }),
};

export function renderNotificationEmail(
  eventType: NotificationEventType,
  context: NotificationContext,
): RenderedEmail {
  return BUILDERS[eventType](context);
}
