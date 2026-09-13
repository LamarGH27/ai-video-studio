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
  description: 'Selected cinematic work. Every piece began as photographs and a written brief.',
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
      <section className="grain relative overflow-hidden surface-glow">
        <div className="grain-layer" aria-hidden="true" />
        <Container className="relative grid gap-8 py-20 sm:py-28 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <p className="eyebrow">Portfolio</p>
            <h1 className="mt-6 display-heading text-display-lg text-balance">
              Work made for people who were never on set.
            </h1>
          </div>
          <p className="leading-relaxed text-bone-400 lg:col-span-4 lg:col-start-9">
            Every piece below started as a set of photographs and a written brief. Pick one you like
            and we will build your version of it.
          </p>
        </Container>
      </section>

      <section className="py-16 rule-top sm:py-20">
        <Container>
          <nav aria-label="Filter portfolio by category">
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link
                  href="/portfolio"
                  aria-current={activeCategory === null ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-10 items-center rounded-full border px-5 text-sm transition-colors',
                    activeCategory === null
                      ? 'border-brass-400/60 bg-brass-400/10 text-brass-200'
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
                      'inline-flex h-10 items-center rounded-full border px-5 text-sm transition-colors',
                      activeCategory === value
                        ? 'border-brass-400/60 bg-brass-400/10 text-brass-200'
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
            <ul className="mt-14 grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((entry, index) => (
                <li
                  key={entry.id}
                  className={cn(
                    'group flex reveal flex-col',
                    // Every third piece drops half a frame on desktop. A grid
                    // whose rows all start at the same y-position reads as a
                    // table of records; a staggered one reads as a contact sheet.
                    index % 3 === 1 && 'lg:mt-16',
                  )}
                >
                  <div className="media-frame aspect-[4/5]">
                    <PortfolioFrame
                      seed={entry.slug}
                      title={entry.title}
                      category={entry.category}
                      showLabel={false}
                      scrim={false}
                      className="transition-transform duration-[1.4s] ease-cinema group-hover:scale-[1.06]"
                    />

                    {/* Revealed on hover and on keyboard focus within the card,
                        so it is not a pointer-only affordance. */}
                    <div className="absolute inset-0 flex items-end bg-ink-990/45 opacity-0 transition-opacity duration-500 group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
                      <p className="p-6 font-mono text-[0.6rem] tracking-[0.3em] text-bone-50/80 uppercase">
                        {categoryLabel(entry.category)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-1 flex-col">
                    <p className="text-[0.65rem] tracking-[0.2em] text-brass-300/75 uppercase">
                      {categoryLabel(entry.category)}
                    </p>
                    <h2 className="mt-2.5 display-heading text-2xl transition-colors group-hover:text-brass-200">
                      {entry.title}
                    </h2>
                    {entry.description ? (
                      <p className="mt-3 flex-1 leading-relaxed text-bone-400">
                        {entry.description}
                      </p>
                    ) : null}

                    <Button asChild variant="link" className="mt-5 self-start">
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
