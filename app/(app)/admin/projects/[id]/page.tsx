import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/features/dashboard/status-badge';
import { ReferenceGallery } from '@/features/dashboard/reference-gallery';
import { StatusControl } from '@/features/admin/status-control';
import { getProjectDetailForAdmin } from '@/lib/data/projects';
import { signReferenceImages } from '@/lib/data/assets';
import { consentLabel } from '@/lib/consent/definitions';
import { allowedAdminTransitions, orientationLabel } from '@/lib/projects/status';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Admin project',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Admin view of one project. The role check runs in app/(app)/admin/layout.tsx. */
export default async function AdminProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const detail = await getProjectDetailForAdmin(id);
  if (!detail) notFound();

  const { project, assets, consents, history } = detail;
  const signedAssets = await signReferenceImages(assets);

  const facts: { label: string; value: string }[] = [
    { label: 'Experience', value: project.video_experiences?.name ?? 'Custom concept' },
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
    { label: 'Submitted', value: formatDateTime(project.submitted_at) },
    { label: 'Customer id', value: project.user_id },
  ];

  return (
    <Container className="py-14 sm:py-20">
      <Button asChild variant="ghost" size="sm" className="-ml-4">
        <Link href="/admin">
          <ArrowLeft aria-hidden="true" />
          Production queue
        </Link>
      </Button>

      <header className="mt-8 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm tracking-wider text-bone-400">
            {project.public_reference}
          </span>
          <StatusBadge status={project.status} />
        </div>
        <h1 className="display-heading text-[clamp(1.875rem,4.5vw,2.75rem)]">
          {project.video_experiences?.name ?? 'Custom concept'}
        </h1>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <section aria-labelledby="admin-brief-heading">
            <h2
              id="admin-brief-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              The brief
            </h2>
            <div className="mt-4 rounded-panel border border-white/10 bg-white/[0.02] p-6">
              <p className="text-bone-100 leading-relaxed whitespace-pre-wrap">
                {project.brief ?? '—'}
              </p>
            </div>
          </section>

          <section aria-labelledby="admin-details-heading">
            <h2
              id="admin-details-heading"
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
            <section aria-labelledby="admin-requirements-heading">
              <h2
                id="admin-requirements-heading"
                className="text-sm font-medium tracking-wide text-bone-400 uppercase"
              >
                Requirements
              </h2>
              <div className="mt-4 space-y-4 text-sm">
                {project.special_requirements ? (
                  <div className="rounded-panel border border-white/10 bg-white/[0.02] p-6">
                    <p className="text-xs tracking-wide text-bone-400 uppercase">Special</p>
                    <p className="text-bone-100 mt-2 leading-relaxed whitespace-pre-wrap">
                      {project.special_requirements}
                    </p>
                  </div>
                ) : null}
                {project.preserve_requirements ? (
                  <div className="rounded-panel border border-rose-400/20 bg-rose-400/[0.03] p-6">
                    <p className="text-xs tracking-wide text-rose-200 uppercase">
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

          <section aria-labelledby="admin-assets-heading">
            <h2
              id="admin-assets-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              Reference images ({signedAssets.length})
            </h2>
            <p className="mt-2 text-xs text-bone-400/70">
              Private customer media, served through short-lived authorised links.
            </p>
            <div className="mt-4">
              <ReferenceGallery assets={signedAssets} />
            </div>
          </section>
        </div>

        <aside className="space-y-12">
          <section aria-labelledby="admin-status-heading">
            <h2
              id="admin-status-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              Move status
            </h2>
            <div className="mt-5">
              <StatusControl
                projectId={project.id}
                currentStatus={project.status}
                allowed={allowedAdminTransitions(project.status)}
              />
            </div>
          </section>

          <section aria-labelledby="admin-consent-heading">
            <h2
              id="admin-consent-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              Consent record
            </h2>
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
          </section>

          <section aria-labelledby="admin-history-heading">
            <h2
              id="admin-history-heading"
              className="text-sm font-medium tracking-wide text-bone-400 uppercase"
            >
              Status history
            </h2>
            <ol className="mt-4 space-y-3 text-sm">
              {history.map((entry) => (
                <li key={entry.id} className="border-l border-white/12 pl-4">
                  <p className="text-bone-100">
                    {entry.from_status ? `${entry.from_status} → ` : ''}
                    {entry.to_status}
                  </p>
                  <p className="mt-1 text-xs text-bone-400/70">
                    {formatDateTime(entry.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </Container>
  );
}
