import Link from 'next/link';
import type { Metadata } from 'next';
import { FolderOpen, Plus } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { ProjectCard } from '@/features/dashboard/project-card';
import { requireUser, getProfile } from '@/lib/auth/session';
import { listMyProjects } from '@/lib/data/projects';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser('/dashboard');
  const [profile, projects] = await Promise.all([getProfile(), listMyProjects(user.id)]);

  const displayName = profile?.display_name?.split(' ')[0] ?? null;
  const drafts = projects.filter((project) => project.status === 'DRAFT');
  const active = projects.filter((project) => project.status !== 'DRAFT');

  // The one thing worth surfacing above everything else: a film waiting to be
  // watched. Anything else can be found by reading down the page.
  const awaitingYou = projects.filter((project) => project.status === 'PREVIEW_READY').length;

  return (
    <Container className="py-14 sm:py-20">
      <header className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Your projects</p>
          <h1 className="mt-6 display-heading text-display-lg">
            {displayName ? `Welcome back, ${displayName}.` : 'Welcome back.'}
          </h1>
          <p className="mt-5 max-w-lg leading-relaxed text-bone-400">
            {awaitingYou > 0
              ? awaitingYou === 1
                ? 'One of your films is ready to watch.'
                : `${awaitingYou} of your films are ready to watch.`
              : 'Everything you have briefed, and where it has got to.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <SignOutButton />
          <Button asChild variant="accent" size="lg">
            <Link href="/create">
              <Plus aria-hidden="true" />
              New project
            </Link>
          </Button>
        </div>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          className="mt-14"
          icon={<FolderOpen className="size-8" aria-hidden="true" />}
          title="No projects yet"
          description="Start a brief and it will appear here, with its status, from the moment you submit it."
          action={
            <Button asChild variant="accent">
              <Link href="/create">Create My Video</Link>
            </Button>
          }
        />
      ) : (
        <div className="mt-14 space-y-14">
          {drafts.length > 0 ? (
            <section aria-labelledby="drafts-heading">
              <h2 id="drafts-heading" className="eyebrow">
                Unfinished drafts
              </h2>
              <p className="mt-3 text-sm text-bone-500">
                Not submitted yet. Pick up where you left off from{' '}
                <Link href="/create" className="text-brass-300 underline-offset-4 hover:underline">
                  Create My Video
                </Link>
                .
              </p>
              <ul className="mt-6 space-y-4">
                {drafts.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </ul>
            </section>
          ) : null}

          {active.length > 0 ? (
            <section aria-labelledby="active-heading">
              <h2 id="active-heading" className="eyebrow">
                In production
              </h2>
              <ul className="mt-6 space-y-4">
                {active.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Container>
  );
}
