import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/features/dashboard/status-badge';
import { ProjectTimeline } from '@/features/dashboard/project-timeline';
import { ReferenceGallery } from '@/features/dashboard/reference-gallery';
import { requireUser } from '@/lib/auth/session';
import { getMyProjectDetail } from '@/lib/data/projects';
import { signReferenceImages } from '@/lib/data/assets';
import { consentLabel } from '@/lib/consent/definitions';
import { orientationLabel, statusDescription } from '@/lib/projects/status';
import { formatDate, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Project', robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

/**
 * A customer's own project.
 *
 * Changing the id in the URL to someone else's project returns a 404: the query
 * is filtered by the session's user id AND the "owner can read own projects" RLS
 * policy removes other people's rows before this code runs. The database is the
 * enforcement point — this page could not show another customer's project even
 * if the check here were removed.
 */
export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/dashboard/projects/${id}`);

  const detail = await getMyProjectDetail(user.id, id);
  if (!detail) notFound();

  const { project, assets, consents, history } = detail;
  const signedAssets = await signReferenceImages(assets);
  const experienceName = project.video_experiences?.name ?? 'Custom concept';

  const facts: { label: string; value: string }[] = [
    { label: 'Experience', value: experienceName },
    { label: 'Mood', value: project.mood ?? '—' },
    { label: 'Location', value: project.environment ?? '—' },
    { label: 'Wardrobe and styling', value: project.wardrobe_style ?? '—' },
    {
      label: 'Orientation',
      value: project.orientation ? orientationLabel(project.orientation) : '—',
    },
    {
      label: 'Approximate length',
      value: project.desired_duration_seconds ? `${project.desired_duration_seconds} seconds` : '—',
    },
    { label: 'Created', value: formatDate(project.created_at) },
    { label: 'Submitted', value: project.submitted_at ? formatDate(project.submitted_at) : '—' },
  ];

  return (
    <Container className="py-14 sm:py-20">
      <Button asChild variant="ghost" size="sm" className="-ml-4">
        <Link href="/dashboard">
          <ArrowLeft aria-hidden="true" />
          All projects
        </Link>
      </Button>

      {query.submitted ? (
        <Alert tone="success" title="Your project has been submitted" className="mt-6">
          A producer will review your brief and reference images. You can follow its progress here.
        </Alert>
      ) : null}

      <header className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm tracking-wider text-bone-400">
              {project.public_reference}
            </span>
            <StatusBadge status={project.status} />
          </div>
          <h1 className="display-heading text-[clamp(1.875rem,4.5vw,2.75rem)]">{experienceName}</h1>
          <p className="max-w-xl leading-relaxed text-bone-400">
            {statusDescription(project.status)}
          </p>
        </div>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <section aria-labelledby="brief-heading">
            <h2
              id="brief-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              The brief
            </h2>
            <div className="mt-4 rounded-panel border border-white/10 bg-white/[0.02] p-6">
              <p className="text-bone-100 leading-relaxed whitespace-pre-wrap">
                {project.brief ?? 'No brief written yet.'}
              </p>
            </div>
          </section>

          <section aria-labelledby="details-heading">
            <h2
              id="details-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              Details
            </h2>
            <dl className="mt-4 grid gap-px overflow-hidden rounded-panel border border-white/10 bg-white/8 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label} className="bg-ink-950 p-5">
                  <dt className="text-xs tracking-wide text-bone-400 uppercase">{fact.label}</dt>
                  <dd className="text-bone-100 mt-2 text-sm break-words">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {project.special_requirements || project.preserve_requirements ? (
            <section aria-labelledby="requirements-heading">
              <h2
                id="requirements-heading"
                className="text-sm font-medium tracking-wide text-bone-400 uppercase"
              >
                Requirements
              </h2>
              <div className="mt-4 space-y-4">
                {project.special_requirements ? (
                  <div className="rounded-panel border border-white/10 bg-white/[0.02] p-6">
                    <p className="text-xs tracking-wide text-bone-400 uppercase">
                      Special requirements
                    </p>
                    <p className="text-bone-100 mt-2 leading-relaxed whitespace-pre-wrap">
                      {project.special_requirements}
                    </p>
                  </div>
                ) : null}
                {project.preserve_requirements ? (
                  <div className="rounded-panel border border-white/10 bg-white/[0.02] p-6">
                    <p className="text-xs tracking-wide text-bone-400 uppercase">
                      Must not be changed
                    </p>
                    <p className="text-bone-100 mt-2 leading-relaxed whitespace-pre-wrap">
                      {project.preserve_requirements}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="assets-heading">
            <h2
              id="assets-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              Reference images ({signedAssets.length})
            </h2>
            <p className="mt-2 text-xs text-bone-400/70">
              Private to your account. Shown here through short-lived authorised links.
            </p>
            <div className="mt-4">
              <ReferenceGallery assets={signedAssets} />
            </div>
          </section>
        </div>

        <aside className="space-y-12">
          <section aria-labelledby="timeline-heading">
            <h2
              id="timeline-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              Production status
            </h2>
            <div className="mt-5">
              <ProjectTimeline status={project.status} history={history} />
            </div>
          </section>

          <section aria-labelledby="consent-heading">
            <h2
              id="consent-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              Your consent
            </h2>
            {consents.length === 0 ? (
              <p className="mt-4 text-sm text-bone-400">
                No consent recorded yet. It is captured when you submit.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {consents.map((consent) => (
                  <li
                    key={consent.id}
                    className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-bone-100 text-sm">{consentLabel(consent.consent_type)}</p>
                      <span
                        className={
                          consent.granted
                            ? 'text-xs font-medium text-emerald-300'
                            : 'text-xs font-medium text-bone-400'
                        }
                      >
                        {consent.granted ? 'Given' : 'Not given'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-bone-400/70">
                      {consent.granted_at ? formatDateTime(consent.granted_at) : '—'} · wording{' '}
                      {consent.wording_version}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </Container>
  );
}
