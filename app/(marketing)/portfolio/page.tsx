import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PortfolioFrame } from '@/features/portfolio/frame';
import { listPortfolioEntries } from '@/lib/data/portfolio';
import {
  EXPERIENCE_CATEGORIES,
  categoryLabel,
  isExperienceCategory,
} from '@/lib/catalog/categories';
import { cn } from '@/lib/utils';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Portfolio',
  description: 'Selected cinematic AI-generated video commissions by AI Video Studio.',
};

/**
 * Category filtering is a server-rendered link list rather than client state:
 * every filter is a real, shareable URL and the page works without JavaScript.
 */
export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const activeCategory = category && isExperienceCategory(category) ? category : null;

  const entries = await listPortfolioEntries();
  const visible = activeCategory
    ? entries.filter((entry) => entry.category === activeCategory)
    : entries;

  return (
    <>
      <section className="border-b border-white/8 surface-glow">
        <Container className="py-20 sm:py-28">
          <p className="eyebrow">Portfolio</p>
          <h1 className="mt-6 max-w-3xl display-heading text-[clamp(2.25rem,6vw,4rem)]">
            Work made for people who were not on set.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-bone-400">
            Every piece below started as a set of photographs and a written brief. Pick one you like
            and we will build your version of it.
          </p>
        </Container>
      </section>

      <section className="py-16 sm:py-20">
        <Container>
          <nav aria-label="Filter portfolio by category">
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link
                  href="/portfolio"
                  aria-current={activeCategory === null ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-9 items-center rounded-full border px-4 text-sm transition-colors',
                    activeCategory === null
                      ? 'text-brass-200 border-brass-400/60 bg-brass-400/10'
                      : 'border-white/12 text-bone-400 hover:border-white/30 hover:text-bone-50',
                  )}
                >
                  All work
                </Link>
              </li>
              {EXPERIENCE_CATEGORIES.map((value) => (
                <li key={value}>
                  <Link
                    href={`/portfolio?category=${value}`}
                    aria-current={activeCategory === value ? 'true' : undefined}
                    className={cn(
                      'inline-flex h-9 items-center rounded-full border px-4 text-sm transition-colors',
                      activeCategory === value
                        ? 'text-brass-200 border-brass-400/60 bg-brass-400/10'
                        : 'border-white/12 text-bone-400 hover:border-white/30 hover:text-bone-50',
                    )}
                  >
                    {categoryLabel(value)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {visible.length === 0 ? (
            <EmptyState
              className="mt-14"
              title="Nothing in this category yet"
              description="We are still adding work here. In the meantime, browse everything or start a brief of your own."
              action={
                <Button asChild variant="outline">
                  <Link href="/portfolio">View all work</Link>
                </Button>
              }
            />
          ) : (
            <ul className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((entry) => (
                <li key={entry.id} className="group flex flex-col">
                  <div className="aspect-[4/5] overflow-hidden rounded-panel border border-white/10">
                    <PortfolioFrame
                      seed={entry.slug}
                      title={entry.title}
                      category={entry.category}
                      className="transition-transform duration-700 group-hover:scale-[1.03]"
                    />
                  </div>

                  <div className="mt-5 flex flex-1 flex-col">
                    <p className="text-[0.65rem] tracking-[0.2em] text-brass-300/70 uppercase">
                      {categoryLabel(entry.category)}
                    </p>
                    <h2 className="mt-2 display-heading text-xl">{entry.title}</h2>
                    {entry.description ? (
                      <p className="mt-2 flex-1 text-sm leading-relaxed text-bone-400">
                        {entry.description}
                      </p>
                    ) : null}

                    <Button asChild variant="link" className="mt-4 self-start">
                      {/* Pre-selects the matching experience in the create flow. */}
                      <Link
                        href={
                          entry.experienceSlug
                            ? `/create?experience=${entry.experienceSlug}`
                            : '/create'
                        }
                      >
                        Create Your Version
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Container>
      </section>
    </>
  );
}
