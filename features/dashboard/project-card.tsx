import Link from 'next/link';
import { ArrowUpRight, Clapperboard, Film } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { PortfolioFrame } from '@/features/portfolio/frame';
import { experienceDisplayName } from '@/lib/catalog/presentation';
import {
  customerHeadline,
  customerNextAction,
  isWaitingOnCustomer,
  statusLabel,
} from '@/lib/projects/status';
import { StatusBadge } from './status-badge';
import type { ProjectWithExperience } from '@/lib/data/projects';
import type { ExperienceCategory } from '@/types/database';

/**
 * A project, presented as a production rather than a row.
 *
 * What someone glancing at this actually wants: is it mine, what is it, what is
 * happening, and is anything waiting on me. So the card leads with a frame and
 * a sentence in their own language — "Your preview is ready to watch" rather
 * than PREVIEW_READY — and the reference, which they need only when they
 * contact us, sits quietly at the top.
 *
 * When the project is waiting on THEM the whole card changes temperature. That
 * is the only state worth interrupting someone for, so it is the only one that
 * gets the accent.
 */
export function ProjectCard({ project }: { project: ProjectWithExperience }) {
  const experienceName = project.video_experiences
    ? experienceDisplayName(project.video_experiences.slug, project.video_experiences.name)
    : 'Custom concept';
  const category = (project.video_experiences?.category ?? 'BESPOKE') as ExperienceCategory;
  const headline = customerHeadline(project.status);
  const nextAction = customerNextAction(project.status);
  const waiting = isWaitingOnCustomer(project.status);
  const isComplete = project.status === 'COMPLETED';

  return (
    <li>
      <Link
        href={`/dashboard/projects/${project.id}`}
        className={[
          'group grid gap-5 overflow-hidden rounded-panel border p-4 transition-all duration-500 sm:grid-cols-[11rem_1fr] sm:items-center sm:gap-6 sm:p-5',
          waiting
            ? 'border-brass-400/35 bg-brass-400/[0.05] hover:border-brass-400/60'
            : 'border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.035]',
        ].join(' ')}
      >
        <div className="media-frame aspect-[16/10] sm:aspect-[4/3]">
          <PortfolioFrame
            seed={project.public_reference}
            title={experienceName}
            category={category}
            showLabel={false}
            className="transition-transform duration-[1.2s] ease-cinema group-hover:scale-[1.06]"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center text-bone-50/35"
          >
            {isComplete ? <Film className="size-7" /> : <Clapperboard className="size-7" />}
          </span>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs tracking-wider text-bone-500">
              {project.public_reference}
            </span>
            <StatusBadge status={project.status} />
          </div>

          <h3 className="mt-3 display-heading text-2xl">{headline}</h3>

          <p className="mt-1.5 truncate text-sm text-bone-400">
            {experienceName}
            <span className="text-bone-500">
              {' · '}
              {project.submitted_at ? 'Submitted' : 'Started'}{' '}
              {formatDate(project.submitted_at ?? project.created_at)}
            </span>
          </p>

          {project.brief ? (
            <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-relaxed text-bone-500">
              {project.brief}
            </p>
          ) : null}

          <p
            className={[
              'mt-4 inline-flex items-center gap-2 text-sm',
              nextAction ? 'text-brass-300' : 'text-bone-500',
            ].join(' ')}
          >
            {nextAction ?? statusLabel(project.status)}
            <ArrowUpRight
              className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
          </p>
        </div>
      </Link>
    </li>
  );
}
