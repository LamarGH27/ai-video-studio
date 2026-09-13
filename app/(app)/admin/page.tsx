import Link from 'next/link';
import type { Metadata } from 'next';
import { Bell, Inbox } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/features/dashboard/status-badge';
import { listAllProjectsForAdmin } from '@/lib/data/projects';
import { formatDate } from '@/lib/utils';
import { nextAdminAction } from '@/lib/projects/status';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

/**
 * Minimal production queue.
 *
 * Deliberately small for the MVP: see what has been submitted, open it, move its
 * status. Preview and final delivery upload are the next milestone and the
 * schema (project_assets.asset_type, the project-deliveries bucket) already
 * supports them.
 */
export default async function AdminPage() {
  const projects = await listAllProjectsForAdmin();

  return (
    <Container className="py-14 sm:py-20">
      <header>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-5 display-heading text-[clamp(2rem,5vw,3rem)]">Production queue</h1>
        <p className="mt-4 max-w-lg leading-relaxed text-bone-400">
          Every submitted brief, newest first. Drafts are not shown — they are not finished.
        </p>

        <div className="mt-6">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/notifications">
              <Bell aria-hidden="true" />
              Notification queue
            </Link>
          </Button>
        </div>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          className="mt-14"
          icon={<Inbox className="size-8" aria-hidden="true" />}
          title="Nothing submitted yet"
          description="Submitted projects appear here as soon as a customer completes a brief."
        />
      ) : (
        <div className="mt-12 overflow-x-auto">
          <table className="w-full min-w-[62rem] border-collapse text-left text-sm">
            <caption className="sr-only">Submitted projects awaiting or in production</caption>
            <thead>
              <tr className="border-b border-white/10 text-xs tracking-wide text-bone-400 uppercase">
                <th scope="col" className="py-3 pr-4 font-medium">
                  Reference
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Customer
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Experience
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Submitted
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Next action
                </th>
                <th scope="col" className="py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-white/8">
                  <td className="py-4 pr-4 font-mono text-xs tracking-wider text-bone-200">
                    {project.public_reference}
                  </td>
                  <td className="text-bone-300 py-4 pr-4">
                    {project.profiles?.display_name ?? '—'}
                  </td>
                  <td className="text-bone-100 py-4 pr-4">
                    {project.video_experiences?.name ?? 'Custom concept'}
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge status={project.status} />
                  </td>
                  <td className="py-4 pr-4 text-bone-400">{formatDate(project.submitted_at)}</td>
                  <td className="text-bone-300 py-4 pr-4">
                    {nextAdminAction(project.status)?.label ?? '—'}
                  </td>
                  <td className="py-4">
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="text-brass-300 underline-offset-4 hover:underline"
                    >
                      Open
                      <span className="sr-only"> project {project.public_reference}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Container>
  );
}
