import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { StatusBadge } from './status-badge';
import type { ProjectWithExperience } from '@/lib/data/projects';

export function ProjectCard({ project }: { project: ProjectWithExperience }) {
  const experienceName = project.video_experiences?.name ?? 'Custom concept';

  return (
    <li>
      <Link
        href={`/dashboard/projects/${project.id}`}
        className="group flex flex-col gap-5 rounded-panel border border-white/10 bg-white/[0.02] p-6 transition-colors hover:border-white/25 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs tracking-wider text-bone-400">
              {project.public_reference}
            </span>
            <StatusBadge status={project.status} />
          </div>

          <p className="truncate display-heading text-xl">{experienceName}</p>

          {project.brief ? (
            <p className="line-clamp-2 max-w-xl text-sm leading-relaxed text-bone-400">
              {project.brief}
            </p>
          ) : (
            <p className="text-sm text-bone-400/70">No brief written yet.</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-6">
          <div className="text-right">
            <p className="text-xs tracking-wide text-bone-400/70 uppercase">
              {project.submitted_at ? 'Submitted' : 'Started'}
            </p>
            <p className="mt-1 text-sm text-bone-200">
              {formatDate(project.submitted_at ?? project.created_at)}
            </p>
          </div>
          <ArrowUpRight
            className="size-5 text-bone-400 transition-colors group-hover:text-brass-300"
            aria-hidden="true"
          />
        </div>
      </Link>
    </li>
  );
}
